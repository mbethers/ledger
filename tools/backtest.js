#!/usr/bin/env node
// Point-in-time backtest: what would Ledger have said on an earlier date, and what happened next?
//   LEDGER_CONTACT=you@example.com node tools/backtest.js 2025-10-03 NVDA INTC VOO ...
// Writes tools/backtest-<date>.json and prints a summary table.
//
// Point-in-time rules (no look-ahead):
//   - SEC facts are filtered to those FILED on or before the as-of date, so later 10-Qs/10-Ks
//     and later restatements are excluded; stock-split detection sees only those filings too.
//   - Price = actual closing price on the last trading day on/before the as-of date. Yahoo's history
//     is split-adjusted after the fact, so any split after that date is reversed to recover the real price.
//   - Treasury yields and FX rates are the values published on that date.
//   - Valuation, checklists and defaults run through the app's own code (src/02–05), unmodified.
// Outcome = total return (dividend-adjusted) from the as-of date to the latest close, vs. the
// S&P 500 total-return index over the same window.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const UA_SEC = { 'User-Agent': `Ledger backtest ${process.env.LEDGER_CONTACT || 'contact@example.com'}` };
const UA_WEB = { 'User-Agent': 'Mozilla/5.0' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- load the app's real logic into a sandbox (no DOM needed for these parts) ----
const ctx = { console, Date, Math, JSON, Number, Object, Array, Map, Set, String, RegExp, Promise, setTimeout, clearTimeout, fetch, URLSearchParams, AbortController, TextEncoder };
vm.createContext(ctx);
for (const f of ['02-calculations.js', '03-xbrl.js', '04-fundamentals.js', '05-data-and-flow.js']) {
  const code = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/^if \(typeof module !== 'undefined'\).*$/m, '');
  vm.runInContext(code, ctx, { filename: f });
}
const app = vm.runInContext(`({ computeValuation, computeGrahamChecklist, computeBuffettChecklist, computeLynchChecklist, computeFundsETFs,
  applyStockDefaults, setEarningsBasis, applyFundDefaults, defaultLynch, buildFundamentals, trailingReturn, Fetcher, ETF_REFERENCE, BENCHMARK_TR, ok })`, ctx);

// ---- data helpers ----
async function yahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d&events=div,split`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: UA_WEB });
    if (res.ok) {
      const r = (await res.json())?.chart?.result?.[0];
      if (!r) throw new Error(`no Yahoo data for ${symbol}`);
      const q = r.indicators.quote[0], adj = r.indicators.adjclose?.[0]?.adjclose || [];
      const rows = r.timestamp.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: q.close[i], adj: adj[i] ?? q.close[i] })).filter(x => x.close != null);
      const splits = Object.values(r.events?.splits || {}).map(s => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: s.numerator / s.denominator }));
      const dividends = Object.values(r.events?.dividends || {}).map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }));
      return { meta: r.meta, rows, splits, dividends };
    }
    await sleep(1500 * (i + 1));
  }
  throw new Error(`Yahoo request failed for ${symbol}`);
}
const rowOnOrBefore = (rows, iso) => { let best = null; for (const r of rows) if (r.date <= iso) best = r; return best; };

async function treasuryOn(iso) {
  const y = iso.slice(0, 4);
  const csv = await (await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}`)).text();
  const lines = csv.trim().split(/\r?\n/); const head = lines[0].split(',').map(h => h.replace(/"/g, ''));
  const i10 = head.indexOf('10 Yr'), i3 = head.indexOf('3 Mo');
  const rows = lines.slice(1).map(l => l.split(',')).map(c => { const [mm, dd, yy] = c[0].split('/'); return { date: `${yy}-${mm}-${dd}`, y10: +c[i10] / 100, m3: +c[i3] / 100 }; });
  const r = rows.filter(r => r.date <= iso).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return { y10: r.y10, m3: r.m3, asOf: r.date };
}

let tickerMap = null;
async function secFacts(ticker, cacheDir) {
  if (!tickerMap) {
    const m = await (await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA_SEC })).json();
    tickerMap = Object.fromEntries(Object.values(m).map(r => [r.ticker.toUpperCase(), String(r.cik_str).padStart(10, '0')]));
  }
  const cik = tickerMap[ticker]; if (!cik) return null;
  const file = path.join(cacheDir, `${ticker}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  await sleep(200);
  const facts = await (await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: UA_SEC })).json();
  fs.writeFileSync(file, JSON.stringify(facts));
  return facts;
}
// Keep only facts filed on or before the as-of date.
function asOfFacts(facts, iso) {
  const out = { ...facts, facts: {} };
  for (const [tax, concepts] of Object.entries(facts.facts || {})) {
    out.facts[tax] = {};
    for (const [tag, c] of Object.entries(concepts)) {
      const units = {};
      for (const [u, pts] of Object.entries(c.units)) { const kept = pts.filter(p => p.filed <= iso); if (kept.length) units[u] = kept; }
      if (Object.keys(units).length) out.facts[tax][tag] = { ...c, units };
    }
  }
  return out;
}

const r2 = (x, d = 2) => (app.ok(x) ? +x.toFixed(d) : null);

async function analyzeStock(ticker, asOf, y, tsy, cacheDir, fxFor) {
  const all = await secFacts(ticker.replace(/\./g, '-'), cacheDir);
  if (!all) return { error: 'not in SEC ticker list' };
  const facts = asOfFacts(all, asOf);
  // Historical FX for foreign filers: patch the app's FX lookup to return the as-of-date rate.
  app.Fetcher.fetchFx = async (cur) => fxFor(cur);
  const fetched = await app.Fetcher.convertForeign(app.buildFundamentals(facts, asOf), ticker);
  const then = rowOnOrBefore(y.rows, asOf);
  const splitAfter = y.splits.filter(s => s.date > asOf).reduce((f, s) => f * s.ratio, 1);
  const quote = { price: then.close * splitAfter, asOf: then.date, source: 'Yahoo Finance (historical close)', name: y.meta.longName };
  const { inp, src, detail } = app.applyStockDefaults(fetched, quote, tsy, ticker, null);
  const run = (input) => {
    const v = app.computeValuation(input), gc = app.computeGrahamChecklist(input, v), bc = app.computeBuffettChecklist(input, v);
    const lc = app.computeLynchChecklist({ ...input, ...app.defaultLynch() }, v);
    return { verdict: v.verdict, confidence: v.confidence, passing: v.methodsPassingMOS, evaluated: v.methodsEvaluated, pe: r2(v.peTTM, 1), pb: r2(v.pb, 1), peg: r2(v.lynchPEG),
      iv: { grahamNumber: r2(v.grahamNumber), grahamRevised: r2(v.grahamRevised), netNet: r2(v.netNet), lynch: r2(v.lynchFairValue), dcf: r2(v.dcfIntrinsic) },
      graham: `${gc.defensivePassCount} | ${gc.enterprisingPassCount}`, buffett: bc.grade, lynch: lc.verdict };
  };
  const out = { name: inp.companyName, splitAfter: splitAfter !== 1 ? splitAfter : undefined, priceThen: r2(quote.price), eps: r2(inp.epsTTM), epsBasis: inp.epsBasis,
    growth: r2(inp.expectedGrowth, 3), epsCAGR5: r2(inp.epsCAGR5, 3), revCAGR5: r2(inp.revCAGR5, 3), roe: r2(inp.avgROE, 3), fundamentalsThrough: inp.periodEnd,
    reported: run(inp), warnings: fetched.warnings.filter(w => !/stock split/.test(w)) };
  if (inp.earningsQuality) {
    out.earningsQuality = inp.earningsQuality.notes;
    if (app.ok(inp.earningsQuality.coreEPS) && inp.earningsQuality.coreEPS > 0) out.core = run({ ...inp, epsTTM: inp.earningsQuality.coreEPS, netIncome: inp.earningsQuality.coreNetIncome, coreEarningsApplied: true });
  }
  if (inp.cyclical) {
    out.cyclical = inp.cyclical.reason;
    if (app.ok(inp.cyclical.normalizedEPS) && inp.cyclical.normalizedEPS > 0) {
      const n = { ...inp }; app.setEarningsBasis(n, { ...src }, { ...detail }, 'normalized');
      out.normalizedEps = r2(n.epsTTM); out.normalized = run(n);
    }
  }
  // Revenue/EPS trajectory known at the time (last 4 fiscal years), to see the trend the model saw.
  out.history = (inp.history || []).filter(h => !h.ttm).slice(0, 4).map(h => `${h.end}: rev ${app.ok(h.revenue) ? (h.revenue / 1e9).toFixed(1) + 'B' : 'n/r'}, EPS ${app.ok(h.eps) ? h.eps.toFixed(2) : 'n/r'}`);
  return out;
}

function analyzeFund(ticker, asOf, y, tsy, bench) {
  const rowsThen = y.rows.filter(r => r.date <= asOf);
  const then = rowsThen[rowsThen.length - 1];
  const quote = { price: then.close, asOf: then.date, source: 'Yahoo Finance (historical close)', name: y.meta.longName, type: y.meta.instrumentType, rows: rowsThen, dividends: y.dividends.filter(d => d.date <= asOf) };
  const { inp } = app.applyFundDefaults(quote, tsy, bench, ticker, null, null);
  const c = app.computeFundsETFs(inp);
  return { name: inp.fundName, priceThen: r2(then.close), verdict: c.verdict, expenseRatio: inp.expenseRatio, return5y: r2(inp.return5y, 4), bench5y: r2(inp.benchReturn5y, 4), sharpe: r2(inp.sharpeRatio) };
}

(async () => {
  const [asOf, ...tickers] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf || '') || !tickers.length) { console.log('Usage: node tools/backtest.js YYYY-MM-DD TICKER [TICKER ...]'); process.exit(1); }
  const cacheDir = path.join(ROOT, 'tools', '.sec-cache'); fs.mkdirSync(cacheDir, { recursive: true });
  const tsy = await treasuryOn(asOf);
  const spx = await yahoo('^SP500TR');
  const spxThen = rowOnOrBefore(spx.rows, asOf), spxNow = spx.rows[spx.rows.length - 1];
  const benchReturn = spxNow.adj / spxThen.adj - 1;
  const benchThen = (() => { const rows = spx.rows.filter(r => r.date <= asOf); const a = app.trailingReturn(rows, 5), b = app.trailingReturn(rows, 10); return { symbol: '^SP500TR', r5: a.val, r10: b.val }; })();
  const fxCache = {};
  const fxFor = async (cur) => {
    if (!fxCache[cur]) { const y = await yahoo(`${cur}USD=X`); const r = rowOnOrBefore(y.rows, asOf); fxCache[cur] = { rate: r.close, asOf: r.date }; }
    return fxCache[cur];
  };
  const results = { asOf, priceDate: spxThen.date, latestDate: spxNow.date, treasury10y: tsy.y10, sp500TotalReturn: +benchReturn.toFixed(4), tickers: {} };
  for (const t of tickers.map(x => x.toUpperCase())) {
    try {
      const y = await yahoo(t);
      const then = rowOnOrBefore(y.rows, asOf), now = y.rows[y.rows.length - 1];
      const outcome = { priceNow: r2(now.close), totalReturn: +(now.adj / then.adj - 1).toFixed(4), vsSP500: +((now.adj / then.adj - 1) - benchReturn).toFixed(4) };
      const isFund = ['ETF', 'MUTUALFUND'].includes(y.meta.instrumentType);
      const analysis = isFund ? analyzeFund(t, asOf, y, tsy, app.ETF_REFERENCE[t]?.benchmark === 'S&P 500' ? benchThen : null) : await analyzeStock(t, asOf, y, tsy, cacheDir, fxFor);
      results.tickers[t] = { type: isFund ? 'fund' : 'stock', ...analysis, ...outcome };
      const a = results.tickers[t];
      const v = a.reported?.verdict || a.verdict;
      console.log(`${t.padEnd(6)} ${String(v).padEnd(48)} P/E ${String(a.reported?.pe ?? '').padStart(6)} | then $${a.priceThen} → now $${a.priceNow} | total ${(a.totalReturn * 100).toFixed(1)}% (vs S&P ${(a.vsSP500 * 100 >= 0 ? '+' : '')}${(a.vsSP500 * 100).toFixed(1)} pts)${a.core ? ` | core: ${a.core.verdict}` : ''}${a.normalized ? ` | normalized (EPS ${a.normalizedEps}): ${a.normalized.verdict}` : ''}`);
    } catch (e) { results.tickers[t] = { error: e.message }; console.log(`${t}: ERROR ${e.message}`); }
  }
  const out = path.join(ROOT, 'tools', `backtest-${asOf}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nS&P 500 total return ${spxThen.date} → ${spxNow.date}: ${(benchReturn * 100).toFixed(1)}%  ·  10yr Treasury then: ${(tsy.y10 * 100).toFixed(2)}%\nSaved ${path.relative(ROOT, out)}`);
})().catch(e => { console.error(e); process.exit(1); });
