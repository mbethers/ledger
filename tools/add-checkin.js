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
const ci = JSON.parse(fs.readFileSync(file, 'utf8'));
p.checkIns = [...(p.checkIns || []), ci];
const errs = lib.validateAll(list);
if (errs.length) { console.error(`validation failed — nothing written:\n  ${errs.join('\n  ')}`); process.exit(1); }
lib.savePortfolios(list);
console.log(`Added check-in ${ci.date} to ${id} (${ci.positions.length} position notes)`);
execFileSync('node', [path.join(__dirname, 'build.js'), '--private'], { stdio: 'inherit' });
