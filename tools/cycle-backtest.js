#!/usr/bin/env node
// Does the cycle-momentum signal (cycleMomentum in src/04-fundamentals.js) predict the next 12 months?
//   LEDGER_CONTACT=you@example.com node tools/cycle-backtest.js [TICKER ...]
// For each ticker and each as-of date (every April and October), runs the app's own extraction on
// SEC filings available at that date, records the phase for stocks flagged cyclical, and measures the
// 12-month total return vs. the S&P 500 total-return index. Writes tools/cycle-backtest.json.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const UA_SEC = { 'User-Agent': `Ledger backtest ${process.env.LEDGER_CONTACT || 'contact@example.com'}` };
const UA_WEB = { 'User-Agent': 'Mozilla/5.0' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = { console, Date, Math, JSON, Number, Object, Array, Map, Set, String, RegExp, Promise };
vm.createContext(ctx);
for (const f of ['02-calculations.js', '03-xbrl.js', '04-fundamentals.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/^if \(typeof module !== 'undefined'\).*$/m, ''), ctx, { filename: f });
}
const buildFundamentals = vm.runInContext('buildFundamentals', ctx);

// Cyclicals across industries — not just the AI/memory names that motivated the signal.
const UNIVERSE = ['MU', 'WDC', 'STX', 'INTC', 'AMD', 'NVDA', 'TXN', 'LRCX', 'AMAT', 'NUE', 'STLD', 'CLF', 'DOW', 'LYB', 'CF', 'MOS',
  'FCX', 'AA', 'CAT', 'DE', 'CMI', 'F', 'GM', 'XOM', 'CVX', 'OXY', 'HAL', 'IP', 'WHR', 'LEN', 'DHI', 'UAL', 'DAL'];
const DATES = []; for (let y = 2017; y <= 2025; y++) DATES.push(`${y}-04-03`, `${y}-10-03`);

async function yahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: UA_WEB });
    if (res.ok) {
      const r = (await res.json())?.chart?.result?.[0]; if (!r) throw new Error(`no Yahoo data for ${symbol}`);
      const q = r.indicators.quote[0], adj = r.indicators.adjclose?.[0]?.adjclose || [];
      return r.timestamp.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), adj: adj[i] ?? q.close[i] })).filter(x => x.adj != null);
    }
    await sleep(1500 * (i + 1));
  }
  throw new Error(`Yahoo request failed for ${symbol}`);
}
const onOrBefore = (rows, iso) => { let b = null; for (const r of rows) { if (r.date > iso) break; b = r; } return b; };
const addYear = (iso) => `${+iso.slice(0, 4) + 1}${iso.slice(4)}`;

let tickerMap = null;
async function secFacts(ticker, cacheDir) {
  const file = path.join(cacheDir, `${ticker}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!tickerMap) {
    const m = await (await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA_SEC })).json();
    tickerMap = Object.fromEntries(Object.values(m).map(r => [r.ticker.toUpperCase(), String(r.cik_str).padStart(10, '0')]));
  }
  const cik = tickerMap[ticker]; if (!cik) return null;
  await sleep(200);
  const facts = await (await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: UA_SEC })).json();
  fs.writeFileSync(file, JSON.stringify(facts));
  return facts;
}
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

(async () => {
  const tickers = process.argv.slice(2).map(t => t.toUpperCase());
  const universe = tickers.length ? tickers : UNIVERSE;
  const cacheDir = path.join(ROOT, 'tools', '.sec-cache'); fs.mkdirSync(cacheDir, { recursive: true });
  const spx = await yahoo('^SP500TR');
  const last = spx[spx.length - 1].date;
  const obs = [];
  for (const t of universe) {
    let facts, px;
    try { facts = await secFacts(t, cacheDir); px = await yahoo(t); } catch (e) { console.log(`${t}: ${e.message}`); continue; }
    if (!facts) { console.log(`${t}: not in SEC ticker list`); continue; }
    for (const d of DATES) {
      const end = addYear(d) <= last ? addYear(d) : last;
      const p0 = onOrBefore(px, d), p1 = onOrBefore(px, end), s0 = onOrBefore(spx, d), s1 = onOrBefore(spx, end);
      if (!p0 || !p1 || p0.date < px[0].date || d < px[0].date) continue;
      const v = buildFundamentals(asOfFacts(facts, d), d).values, cy = v.cyclical, m = cy?.momentum;
      const ret = p1.adj / p0.adj - 1, excess = ret - (s1.adj / s0.adj - 1);
      obs.push({ t, d, cyclical: !!cy, phase: m?.phase ?? null, revGrowth: m?.revGrowth, marginChange: m?.marginChange, margin: m?.margin,
        avgMargin: cy?.avgMargin, maxMargin: cy?.maxMargin, ret: +ret.toFixed(4), excess: +excess.toFixed(4), partial: end !== addYear(d) });
    }
    process.stdout.write(`${t} `);
  }
  console.log('\n');
  fs.writeFileSync(path.join(ROOT, 'tools', 'cycle-backtest.json'), JSON.stringify(obs, null, 1));

  const stats = (rows) => {
    if (!rows.length) return 'n=0';
    const xs = rows.map(r => r.excess).sort((a, b) => a - b), mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const med = xs[Math.floor(xs.length / 2)], beat = xs.filter(x => x > 0).length / xs.length;
    return `n=${String(rows.length).padStart(3)}  mean ${(mean * 100).toFixed(1).padStart(6)}  median ${(med * 100).toFixed(1).padStart(6)}  beat S&P ${(beat * 100).toFixed(0).padStart(3)}%`;
  };
  const cyc = obs.filter(o => o.cyclical && o.phase);
  console.log('12-month return vs. S&P 500 (percentage points), cyclical-flagged observations:');
  for (const ph of ['upswing', 'steady', 'downswing']) console.log(`  ${ph.padEnd(10)} ${stats(cyc.filter(o => o.phase === ph))}`);
  console.log(`  ${'all'.padEnd(10)} ${stats(cyc)}`);
  console.log(`  not flagged cyclical: ${stats(obs.filter(o => !o.cyclical))}`);
  // Early vs late upswing: is the current margin still below the 10-yr high?
  const up = cyc.filter(o => o.phase === 'upswing');
  console.log('\nUpswing split by margin vs. its 10-yr high:');
  console.log(`  margin < 60% of high  ${stats(up.filter(o => o.margin < 0.6 * o.maxMargin))}`);
  console.log(`  margin ≥ 60% of high  ${stats(up.filter(o => o.margin >= 0.6 * o.maxMargin))}`);
  console.log('\nBy year (upswing):');
  for (const y of [...new Set(up.map(o => o.d.slice(0, 4)))].sort()) console.log(`  ${y}  ${stats(up.filter(o => o.d.startsWith(y)))}`);
  console.log('\nExcluding 2025 (the AI-memory year that motivated this):');
  for (const ph of ['upswing', 'steady', 'downswing']) console.log(`  ${ph.padEnd(10)} ${stats(cyc.filter(o => o.phase === ph && !o.d.startsWith('2025')))}`);
})().catch(e => { console.error(e); process.exit(1); });
