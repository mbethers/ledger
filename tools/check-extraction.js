#!/usr/bin/env node
// Regression check for the SEC data extraction, run outside the browser against live filings.
//   node tools/check-extraction.js NKE AAPL KO PLPC
// Prints the core fields the valuation depends on (or the reason each is missing) and any
// warnings, so a change to src/03-xbrl.js or src/04-fundamentals.js can be checked in seconds.
// Talks to SEC directly (Node isn't subject to browser CORS rules); SEC asks for a contact
// address in the User-Agent, set via LEDGER_CONTACT or the default below.
'use strict';
const path = require('path');

const { XBRL, dDays } = require(path.join(__dirname, '..', 'src', '03-xbrl.js'));
Object.assign(globalThis, { XBRL, dDays }); // 04-fundamentals expects these as browser globals
const { buildFundamentals } = require(path.join(__dirname, '..', 'src', '04-fundamentals.js'));

const UA = { 'User-Agent': `Ledger research tool ${process.env.LEDGER_CONTACT || 'contact@example.com'}` };
const CORE = ['revenue', 'netIncome', 'epsTTM', 'dilutedShares', 'totalEquity', 'totalCurrentAssets', 'totalCurrentLiabilities',
  'totalLiabilities', 'totalDebt', 'operatingCashFlow', 'capex', 'da', 'ebit', 'interestExpense', 'revCAGR5', 'epsCAGR5', 'avgROE'];

const show = (v) => (v == null ? 'NULL' : Math.abs(v) < 100 ? v.toFixed(4) : Math.round(v).toLocaleString('en-US'));

(async () => {
  const tickers = process.argv.slice(2).map(t => t.toUpperCase().replace(/[./]/g, '-'));
  if (!tickers.length) { console.log('Usage: node tools/check-extraction.js TICKER [TICKER ...]'); process.exit(1); }
  const map = await (await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA })).json();
  const byTicker = Object.fromEntries(Object.values(map).map(r => [r.ticker.toUpperCase(), String(r.cik_str).padStart(10, '0')]));
  for (const t of tickers) {
    const cik = byTicker[t];
    if (!cik) { console.log(`\n=== ${t}: not in SEC's operating-company ticker list (ETF/fund/foreign?)`); continue; }
    const facts = await (await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: UA })).json();
    const r = buildFundamentals(facts);
    console.log(`\n=== ${t}  income through ${r.values.periodEnd} · balance sheet ${r.values.balanceSheetDate} · EPS basis: ${r.values.epsBasis}`);
    for (const f of CORE) console.log(`  ${f.padEnd(24)} ${show(r.values[f]).padStart(20)}  ${r.values[f] == null ? 'WHY: ' + r.why[f] : ''}`);
    console.log(`  history rows: ${r.values.history?.length || 0}`);
    r.warnings.forEach(w => console.log(`  ! ${w}`));
    await new Promise(res => setTimeout(res, 250)); // stay well under SEC's 10 requests/second
  }
})().catch(e => { console.error(e); process.exit(1); });
