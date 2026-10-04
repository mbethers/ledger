#!/usr/bin/env node
// Append a check-in to a recorded portfolio (positions are never edited).
//   node tools/add-checkin.js <portfolioId> research/drafts/<checkin>.json
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./research-lib');
const { execFileSync } = require('child_process');

const [id, file] = process.argv.slice(2);
if (!id || !file) { console.log('Usage: node tools/add-checkin.js <portfolioId> <checkin.json>'); process.exit(1); }
const list = lib.loadPortfolios();
const p = list.find(x => x.id === id);
if (!p) { console.error(`no portfolio ${id}`); process.exit(1); }
let ci;
try { ci = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error(`could not read check-in file ${file}: ${e.message}`); process.exit(1); }
if (!ci || !Array.isArray(ci.positions)) { console.error(`check-in file ${file} needs a "positions" array (use [] if no position notes)`); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
const last = (p.checkIns || []).at(-1)?.date;
if (typeof ci.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ci.date)) { console.error('check-in date must be YYYY-MM-DD'); process.exit(1); }
if (last && ci.date < last) { console.error(`check-in ${ci.date} is before the last check-in (${last}) — check-ins are append-only and in date order`); process.exit(1); }
if (ci.date > today) { console.error(`check-in ${ci.date} is in the future (today is ${today})`); process.exit(1); }
p.checkIns = [...(p.checkIns || []), ci];
const errs = lib.validateAll(list);
if (errs.length) { console.error(`validation failed — nothing written:\n  ${errs.join('\n  ')}`); process.exit(1); }
lib.savePortfolios(list);
console.log(`Added check-in ${ci.date} to ${id} (${ci.positions.length} position notes)`);
execFileSync('node', [path.join(__dirname, 'build.js'), '--private'], { stdio: 'inherit' });
