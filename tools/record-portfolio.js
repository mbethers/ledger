#!/usr/bin/env node
// Freeze a researched draft into research/portfolios.json with real closing prices.
//   node tools/record-portfolio.js research/drafts/2026-10-05-3y.json [--date 2026-10-05]
// Entry date = the given date (default: the benchmark's latest trading day). Every holding must have
// a close on that exact date; otherwise nothing is written.
'use strict';
const fs = require('fs');
const lib = require('./research-lib');
const { execFileSync } = require('child_process');

(async () => {
  const file = process.argv[2];
  const di = process.argv.indexOf('--date'); const want = di > 0 ? process.argv[di + 1] : null;
  if (!file) { console.log('Usage: node tools/record-portfolio.js <draft.json> [--date YYYY-MM-DD]'); process.exit(1); }
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = lib.loadPortfolios();
  if (list.some(x => x.id === p.id)) throw new Error(`id ${p.id} already recorded — portfolios are never overwritten`);

  const from = want || new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const bench = await lib.yahooSeries('^SP500TR', from);
  const day = want || bench.rows.at(-1).date;
  const b = bench.rows.find(r => r.date === day);
  if (!b) throw new Error(`no ^SP500TR close on ${day} (not a trading day?)`);

  const missing = [];
  for (const x of p.positions) {
    const s = await lib.yahooSeries(x.ticker, from).catch(() => null);
    const r = s?.rows.find(r => r.date === day);
    if (!r) missing.push(x.ticker); else x.entryPrice = +r.close.toFixed(4);
    await new Promise(ok => setTimeout(ok, 250));
  }
  if (missing.length) throw new Error(`no close on ${day} for: ${missing.join(', ')} — nothing written`);

  Object.assign(p, { createdAt: new Date().toISOString(), entryDate: day, benchmark: '^SP500TR', benchmarkEntry: +b.close.toFixed(4), checkIns: [] });
  p.fingerprint = lib.fingerprint(p);
  const errs = lib.validateAll([...list, p]);
  if (errs.length) throw new Error(`validation failed — nothing written:\n  ${errs.join('\n  ')}`);
  lib.savePortfolios([...list, p]);
  console.log(`Recorded ${p.id}: ${p.positions.length} positions, entry ${day}, S&P TR ${b.close.toFixed(2)}`);
  execFileSync('node', [require('path').join(__dirname, 'build.js'), '--private'], { stdio: 'inherit' });
})().catch(e => { console.error(e.message); process.exit(1); });
