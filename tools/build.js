#!/usr/bin/env node
// Builds the single-file app from the parts in src/.
//   node tools/build.js            → ledger.html (public; research data always empty)
//   node tools/build.js --private  → ledger.private.html with research/portfolios.json inlined,
//                                    also copied to <shareDir>/ledger.html if research/config.json sets shareDir
// Parts are concatenated in filename order. The Node-only `module.exports` line at the end of
// the XBRL/fundamentals parts (used by tools/check-extraction.js) is stripped from the output.
// The combined script is syntax-checked before anything is written, so a typo fails the build
// instead of shipping a page that silently does nothing.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const SLOT = /\/\*RESEARCH_DATA\*\/([\s\S]*?)\/\*END_RESEARCH_DATA\*\//;

function assemble({ research = null } = {}) {
  const parts = fs.readdirSync(srcDir).filter(f => /^\d\d-.*\.(html|js)$/.test(f)).sort();
  if (!parts.length) throw new Error('No parts found in src/');
  let html = parts.map(f => {
    let text = fs.readFileSync(path.join(srcDir, f), 'utf8');
    if (f.endsWith('.js')) text = text.replace(/^if \(typeof module !== 'undefined'\).*$/m, '');
    return text.endsWith('\n') ? text : text + '\n';
  }).join('');
  const slot = html.match(SLOT);
  if (!slot) throw new Error('Build failed: research data slot not found in src/02-research-core.js');
  if (research === null) {
    if (slot[1] !== '[]') throw new Error('Build failed: public build would include research data');
  } else {
    // Escape "<" so research text can never close the <script> element.
    html = html.replace(SLOT, () => `/*RESEARCH_DATA*/${JSON.stringify(research).replace(/</g, '\\u003c')}/*END_RESEARCH_DATA*/`);
  }
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('Build failed: no <script> block found.');
  try { new vm.Script(m[1], { filename: 'ledger.html <script>' }); }
  catch (e) { throw new Error(`Build failed — script syntax error:\n${e.stack.split('\n').slice(0, 5).join('\n')}`); }
  return html;
}

if (require.main === module) {
  try {
    const isPrivate = process.argv.includes('--private');
    if (!isPrivate) {
      const html = assemble({ research: null });
      fs.writeFileSync(path.join(root, 'ledger.html'), html);
      console.log(`Built ledger.html (${(html.length / 1024).toFixed(0)} KB, public — no research data)`);
    } else {
      const lib = require('./research-lib');
      const list = lib.loadPortfolios();
      const errs = lib.validateAll(list);
      if (errs.length) throw new Error(`research/portfolios.json failed validation:\n  ${errs.join('\n  ')}`);
      const html = assemble({ research: list });
      const out = path.join(root, 'ledger.private.html');
      fs.writeFileSync(out, html);
      console.log(`Built ledger.private.html (${(html.length / 1024).toFixed(0)} KB) with ${list.length} research portfolio(s)`);
      if (fs.existsSync(lib.CONFIG_FILE)) {
        const { shareDir } = JSON.parse(fs.readFileSync(lib.CONFIG_FILE, 'utf8'));
        if (shareDir) {
          const dir = shareDir.replace(/^~(?=$|\/)/, os.homedir());
          if (!fs.existsSync(dir)) throw new Error(`shareDir not found: ${dir} (is Google Drive for desktop running?)`);
          fs.copyFileSync(out, path.join(dir, 'ledger.html'));
          console.log(`Copied to ${path.join(dir, 'ledger.html')}`);
        }
      }
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { assemble };
