#!/usr/bin/env node
// Score research portfolios against the S&P 500 total-return index using the app's own scoring code.
//   node tools/score-portfolios.js [portfolioId]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const lib = require('./research-lib');

const ctx = { console, Date, Math, JSON, Number, Object, Array, Map, Set, String, RegExp, Promise };
vm.createContext(ctx);
for (const f of ['02-calculations.js', '02-research-core.js']) vm.runInContext(fs.readFileSync(path.join(lib.ROOT, 'src', f), 'utf8'), ctx, { filename: f });
const pct = (x) => (x == null ? '   n/a' : `${(x * 100).toFixed(1).padStart(6)}%`);

// Negative calls: a hit is a name that lagged the S&P over the same window.
function printAvoid(a) {
  if (!a) return;
  console.log(`  avoid list: ${a.hits}/${a.scored} lagged the S&P · basket ${pct(a.basketRet)} vs S&P ${pct(a.benchRet)}${a.why ? ` (${a.why})` : ''}`);
  for (const r of a.rows) console.log(`    ${r.ticker.padEnd(7)} ret ${pct(r.ret)} vs S&P ${pct(r.vsBench)} ${r.hit == null ? r.why : r.hit ? '✓ lagged' : '✗ beat the S&P'}`);
}

(async () => {
  const only = process.argv[2];
  const list = lib.loadPortfolios().filter(p => !only || p.id === only);
  if (!list.length) { console.log(only ? `no portfolio ${only}` : 'no portfolios in research/portfolios.json'); return; }
  const today = new Date().toISOString().slice(0, 10);
  const cache = {};
  const get = async (sym, from) => (cache[`${sym}|${from}`] ||= await lib.yahooSeries(sym, from).then(s => s.rows).catch(() => null));
  for (const p of list) {
    const series = {};
    for (const sym of [p.benchmark, ...p.positions.map(x => x.ticker), ...(p.avoid || []).map(x => x.ticker)]) { const r = await get(sym, p.entryDate); if (r) series[sym] = r; }
    const s = ctx.scorePortfolio(p, series, today);
    console.log(`\n${p.id}  (${p.horizonYears}-yr, entry ${p.entryDate}, ${s.matured ? 'MATURED' : `day ${s.days}`})`);
    if (!s.total) { console.log(`  total unavailable: ${s.why}`); printAvoid(s.avoid); continue; }
    const t = s.total;
    console.log(`  portfolio ${pct(t.ret)}   S&P ${pct(t.benchRet)}   excess ${pct(t.excess)}   max DD ${pct(t.maxDrawdown)} vs ${pct(t.benchMaxDrawdown)}   vol ${pct(t.vol)} vs ${pct(t.benchVol)}`);
    for (const x of [...s.positions].sort((a, b) => b.contribution - a.contribution))
      console.log(`    ${x.ticker.padEnd(7)} ${pct(x.weight)} ret ${pct(x.ret)} contrib ${pct(x.contribution)}${x.status ? `  [${x.status}]` : ''}${x.exited ? ' exited' : ''}${x.approx ? ' (approx)' : ''}`);
    printAvoid(s.avoid);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
