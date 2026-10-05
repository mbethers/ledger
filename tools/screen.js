#!/usr/bin/env node
// Bottom-up screen for the research process: runs Ledger's own valuation over the S&P 500, a curated
// ADR list and bond funds, as of today. Output: research/screen-<date>.json (private) + summary lists.
//   LEDGER_CONTACT=you@example.com node tools/screen.js [--limit N]
// S&P 500 members come from Wikipedia's constituents table (cached in research/sp500-<date>.txt).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const lib = require('./research-lib');

const ROOT = lib.ROOT;
const UA_SEC = { 'User-Agent': `Ledger screen ${process.env.LEDGER_CONTACT || 'contact@example.com'}` };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
// Fundamentals more than 15 months old (common for foreign filers) can't be trusted for valuation.
const staleCutoff = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 15); return d.toISOString().slice(0, 10); })();
const isStale = (periodEnd) => typeof periodEnd === 'string' && periodEnd < staleCutoff;

const ctx = { console, Date, Math, JSON, Number, Object, Array, Map, Set, String, RegExp, Promise, setTimeout, clearTimeout, fetch, URLSearchParams, AbortController, TextEncoder };
vm.createContext(ctx);
for (const f of ['02-calculations.js', '02-research-core.js', '03-xbrl.js', '04-fundamentals.js', '05-data-and-flow.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/^if \(typeof module !== 'undefined'\).*$/m, ''), ctx, { filename: f });
const app = vm.runInContext('({ buildFundamentals, applyStockDefaults, computeValuation, impliedGrowth, Fetcher, ok })', ctx);
ctx.renderFetchStatus = () => {}; // Fetcher.note calls this in the browser

const readList = (f) => fs.readFileSync(path.join(__dirname, 'universe', f), 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));

async function sp500() {
  const cache = path.join(ROOT, 'research', `sp500-${today}.txt`);
  if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean);
  const html = await (await fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const table = html.slice(html.indexOf('id="constituents"')); const body = table.slice(0, table.indexOf('</table>'));
  const tickers = [...body.matchAll(/<tr[^>]*>\s*<td[^>]*>\s*(?:<a[^>]*>)?([A-Z.]{1,6})<\/a>/g)].map(m => m[1].replace('.', '-'));
  if (tickers.length < 480) throw new Error(`S&P 500 list parse found only ${tickers.length} tickers — Wikipedia layout changed?`);
  fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, tickers.join('\n'));
  return tickers;
}

let tickerMap = null;
async function secFacts(ticker) {
  const dir = path.join(ROOT, 'tools', '.sec-cache'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ticker}.json`);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 86400000) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!tickerMap) {
    const m = await (await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA_SEC })).json();
    tickerMap = Object.fromEntries(Object.values(m).map(r => [r.ticker.toUpperCase(), String(r.cik_str).padStart(10, '0')]));
  }
  const cik = tickerMap[ticker] || tickerMap[ticker.replace('-', '.')]; if (!cik) return null;
  await sleep(150);
  const facts = await (await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: UA_SEC })).json();
  fs.writeFileSync(file, JSON.stringify(facts));
  return facts;
}

const tsyNow = async () => {
  const y = today.slice(0, 4);
  const csv = await (await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}`)).text();
  const lines = csv.trim().split(/\r?\n/), head = lines[0].split(',').map(h => h.replace(/"/g, '')), i10 = head.indexOf('10 Yr');
  const [d, ...c] = lines[1].split(','); const [mm, dd, yy] = d.split('/');
  return { y10: +c[i10 - 1] / 100, asOf: `${yy}-${mm}-${dd}` };
};

function priceStats(rows) {
  const last = rows.at(-1), yearAgo = rows.find(r => r.date >= new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10));
  const hi = Math.max(...rows.filter(r => r.date >= yearAgo.date).map(r => r.close));
  return { price: last.close, ret1y: last.adj / yearAgo.adj - 1, offHigh: last.close / hi - 1 };
}

(async () => {
  const li = process.argv.indexOf('--limit'); const limit = li > 0 ? +process.argv[li + 1] : Infinity;
  const tsy = await tsyNow();
  app.Fetcher.fetchFx = async (cur) => { const s = await lib.yahooSeries(`${cur}USD=X`, new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10)); return { rate: s.rows.at(-1).close, asOf: s.rows.at(-1).date }; };
  const universe = [...(await sp500()).map(t => [t, 'stock']), ...readList('adrs.txt').map(t => [t, 'adr']), ...readList('bond-funds.txt').map(t => [t, 'bond-fund'])].slice(0, limit);
  const out = [];
  const from = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  for (const [t, kind] of universe) {
    const row = { ticker: t, kind };
    try {
      const y = await lib.yahooSeries(t, from); Object.assign(row, priceStats(y.rows)); row.name = y.meta.longName || y.meta.shortName || null;
      if (kind !== 'bond-fund') {
        const facts = await secFacts(t);
        if (!facts) row.error = 'not in SEC ticker list';
        else {
          const fetched = await app.Fetcher.convertForeign(app.buildFundamentals(facts, today), t);
          const { inp } = app.applyStockDefaults(fetched, { price: row.price, asOf: today, source: 'Yahoo' }, tsy, t, null);
          const v = app.computeValuation(inp), ig = app.impliedGrowth(inp);
          Object.assign(row, { verdict: v.verdict, passing: v.methodsPassingMOS, pe: v.peTTM, pb: v.pb, impliedGrowth: ig.g, impliedWhy: ig.why,
            epsCAGR5: inp.epsCAGR5, revCAGR5: inp.revCAGR5, cyclical: !!inp.cyclical, qualityFlag: v.qualityFlag,
            periodEnd: inp.periodEnd ?? null, stale: isStale(inp.periodEnd) });
          // Shareholder yield: cash returned to owners as a share of market cap (dividends + net buybacks).
          const mc = v.marketCapV;
          if (app.ok(mc) && mc > 0) {
            row.divYield = app.ok(inp.dividendsPaid) ? inp.dividendsPaid / mc : null;
            row.buybackYield = app.ok(inp.netBuybacks) ? inp.netBuybacks / mc : null;
            row.shareholderYield = row.divYield != null && row.buybackYield != null ? row.divYield + row.buybackYield : null;
          }
        }
      }
    } catch (e) { row.error = e.message; }
    out.push(row); process.stdout.write(row.error ? 'x' : '.');
    await sleep(200);
  }
  const file = path.join(ROOT, 'research', `screen-${today}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(out, null, 1));
  const pct = (x) => (app.ok(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');
  const show = (title, rows, f) => { console.log(`\n${title}`); rows.slice(0, 25).forEach(r => console.log(`  ${r.ticker.padEnd(6)} ${f(r)}${r.stale ? ` · STALE data through ${r.periodEnd}` : ''}`)); };
  const stocks = out.filter(r => !r.error && r.kind !== 'bond-fund');
  show('Most methods passing margin of safety:', [...stocks].sort((a, b) => (b.passing - a.passing) || ((a.impliedGrowth ?? 9) - (b.impliedGrowth ?? 9))), r => `${r.passing}/5 pass · implied growth ${pct(r.impliedGrowth)} · P/E ${r.pe?.toFixed?.(1) ?? 'n/a'} · ${r.verdict}`);
  show('Furthest below 52-week high:', [...out.filter(r => !r.error)].sort((a, b) => a.offHigh - b.offHigh), r => `${pct(r.offHigh)} off high · 1y ${pct(r.ret1y)} · ${r.kind}`);
  show('Highest shareholder yield (dividends + net buybacks ÷ market cap):', stocks.filter(r => app.ok(r.shareholderYield)).sort((a, b) => b.shareholderYield - a.shareholderYield),
    r => `${pct(r.shareholderYield)} (dividends ${pct(r.divYield)} + net buybacks ${pct(r.buybackYield)}) · P/E ${r.pe?.toFixed?.(1) ?? 'n/a'}${r.qualityFlag ? ' · quality flag' : ''}`);
  show('Implied growth furthest below 5-yr revenue growth:', stocks.filter(r => app.ok(r.impliedGrowth) && app.ok(r.revCAGR5)).sort((a, b) => (a.impliedGrowth - a.revCAGR5) - (b.impliedGrowth - b.revCAGR5)), r => `implied ${pct(r.impliedGrowth)} vs 5-yr revenue ${pct(r.revCAGR5)}${r.cyclical ? ' · cyclical' : ''}`);
  console.log(`\n${out.length} screened (${out.filter(r => r.error).length} errors). Saved ${path.relative(ROOT, file)}`);
})().catch(e => { console.error(e); process.exit(1); });
