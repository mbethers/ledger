#!/usr/bin/env node
// Builds the single-file app (ledger.html) from the parts in src/.
//   node tools/build.js
// Parts are concatenated in filename order. The Node-only `module.exports` line at the end of
// the XBRL/fundamentals parts (used by tools/check-extraction.js) is stripped from the output.
// The combined script is syntax-checked before anything is written, so a typo fails the build
// instead of shipping a page that silently does nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const outFile = path.join(root, 'ledger.html');

const parts = fs.readdirSync(srcDir).filter(f => /^\d\d-.*\.(html|js)$/.test(f)).sort();
if (!parts.length) { console.error('No parts found in src/'); process.exit(1); }

const html = parts.map(f => {
  let text = fs.readFileSync(path.join(srcDir, f), 'utf8');
  if (f.endsWith('.js')) text = text.replace(/^if \(typeof module !== 'undefined'\).*$/m, '');
  return text.endsWith('\n') ? text : text + '\n';
}).join('');

const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('Build failed: no <script> block found.'); process.exit(1); }
try { new vm.Script(m[1], { filename: 'ledger.html <script>' }); }
catch (e) { console.error(`Build failed — script syntax error:\n${e.stack.split('\n').slice(0, 5).join('\n')}`); process.exit(1); }

fs.writeFileSync(outFile, html);
console.log(`Built ledger.html (${(html.length / 1024).toFixed(0)} KB) from ${parts.length} parts: ${parts.join(', ')}`);
