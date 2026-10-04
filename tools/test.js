#!/usr/bin/env node
// Minimal test runner: loads the app's pure-logic parts of src/ into a vm context (the same way the
// backtest tools do) and runs every tools/tests/*.test.js. No dependencies.
//   node tools/test.js            # all tests
//   node tools/test.js score      # only files whose name contains "score"
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const SRC_PARTS = ['02-calculations.js', '02-research-core.js', '03-xbrl.js', '04-fundamentals.js'];

function loadApp() {
  const ctx = { console, Date, Math, JSON, Number, Object, Array, Map, Set, String, RegExp, Promise, setTimeout, clearTimeout };
  vm.createContext(ctx);
  for (const f of SRC_PARTS) {
    const file = path.join(ROOT, 'src', f);
    if (!fs.existsSync(file)) continue; // parts added by later tasks
    vm.runInContext(fs.readFileSync(file, 'utf8').replace(/^if \(typeof module !== 'undefined'\).*$/m, ''), ctx, { filename: f });
  }
  return ctx;
}

const filter = process.argv[2] || '';
const files = fs.readdirSync(path.join(__dirname, 'tests')).filter(f => f.endsWith('.test.js') && f.includes(filter)).sort();
let passed = 0, failed = 0;
(async () => {
  for (const f of files) {
    const tests = [];
    const test = (name, fn) => tests.push({ name, fn });
    require(path.join(__dirname, 'tests', f))({ test, assert, app: (code) => vm.runInContext(code, loadApp()), loadApp, ROOT });
    for (const t of tests) {
      try { await t.fn(); passed++; console.log(`  ✓ ${f} › ${t.name}`); }
      catch (e) { failed++; console.log(`  ✗ ${f} › ${t.name}\n      ${String(e.stack || e).split('\n').slice(0, 4).join('\n      ')}`); }
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
