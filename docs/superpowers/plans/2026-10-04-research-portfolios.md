# Research Portfolios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "What's priced in" (reverse-DCF) panel, plus hypothetical research portfolios (1–5 yr horizons) that are researched in Claude Code, frozen at creation, and scored in the app against the S&P 500 total-return index.

**Architecture:**
- Pure logic lives in `src/`, so the app and Node tools share it. That means the reverse DCF in `02-calculations.js` and portfolio scoring in a new `02-research-core.js`.
- Node-only tooling lives in `tools/`: validation and fingerprints, recording portfolios and check-ins, scoring from the CLI, and the screen.
- Research data lives in a git-ignored `research/portfolios.json`. The build inlines it only into a private build (`ledger.private.html`, also copied to Google Drive). The public `ledger.html` always ships an empty array.

**Tech Stack:** Vanilla browser JS concatenated into one HTML file by `tools/build.js`, and Node 18+ scripts using `vm` to load `src/` (the existing pattern in `tools/backtest.js`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-research-portfolios-design.md`

## Global Constraints

- Every research screen shows: *"Hypothetical research portfolios — not investment advice."*
- Universe: US-listed stocks and ETFs, international ADRs, bond funds. Long only; cash allowed. Position `type` ∈ `stock | etf | adr | bond-fund`.
- Benchmark: `^SP500TR` (Yahoo S&P 500 total-return index).
- Positions: 10–20. Weight per position: > 0 and ≤ 0.15. Position weights + `cashWeight` = 1 (±0.001). Sum of weights per `theme` ≤ 0.35.
- Thesis fields, all required non-empty strings: `pricedIn`, `consensus`, `variant`, `catalyst`, `killCriteria`.
- Check-in status ∈ `intact | weakened | broken`.
- Positions, weights, `entryPrice`, `entryDate`, `benchmarkEntry` and `cashWeight` are immutable after creation; a `fingerprint` (sha256) enforces this. `checkIns` is append-only.
- Scoring: buy-and-hold (weights drift), dividends via Yahoo adjusted close, cash earns 0%, score frozen at `entryDate + horizonYears`. A holding with no price data makes the total **unavailable** — never filled with 0.
- Research data is never committed. `research/` and `ledger.private.html` are git-ignored. The public build must contain no research data, and the build fails otherwise.
- Missing data is always shown with a reason (the app-wide `unav(why)` convention). Never show 0 as a stand-in.
- After editing anything in `src/`, run `node tools/build.js`, and commit the `src/` change and the rebuilt `ledger.html` together.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `tools/test.js` | create | Minimal test runner: loads `src/` parts into a `vm` context, runs `tools/tests/*.test.js` |
| `tools/tests/implied-growth.test.js` | create | Reverse-DCF tests |
| `tools/tests/score.test.js` | create | Scoring tests |
| `tools/tests/validate.test.js` | create | Validation and fingerprint tests |
| `tools/tests/build.test.js` | create | Public/private build tests |
| `tools/fixtures/portfolio-fixture.json` | create | TEST-ONLY portfolio used by tests and UI checks |
| `src/02-calculations.js` | modify | Add `impliedGrowth(inp)` |
| `src/02-research-core.js` | create | `RESEARCH_DATA` placeholder, `scorePortfolio()`, `horizonEnd()` |
| `src/05-data-and-flow.js` | modify | Add quiet `fetchAdjSeries(symbol, fromISO)` for the research view |
| `src/06-render.js` | modify | "What's priced in" panel on the stock Summary tab |
| `src/06-render-research.js` | create | Research list and detail views, comparison chart |
| `src/07-events.js` | modify | Research button and research-view click handlers |
| `src/01-head.html` | modify | Research button, `#researchView` section, CSS |
| `tools/research-lib.js` | create | Node: `fingerprint()`, `validatePortfolio()`, `validateAll()`, `loadPortfolios()`, Yahoo helpers |
| `tools/build.js` | modify | `assemble({ research })` export, `--private` mode, Drive copy |
| `tools/record-portfolio.js` | create | Draft → fetch entry prices → fingerprint → validate → append → private build |
| `tools/add-checkin.js` | create | Append a validated check-in → private build |
| `tools/score-portfolios.js` | create | CLI scoring using `scorePortfolio` |
| `tools/screen.js` | create | Bottom-up screen over S&P 500, ADRs and bond funds |
| `tools/universe/adrs.txt`, `tools/universe/bond-funds.txt` | create | Curated screen lists |
| `.claude/skills/ledger-research/SKILL.md` | create | Research and check-in procedure |
| `.gitignore` | modify | `research/`, `ledger.private.html` |
| `README.md` | modify | Document tests, priced-in panel, research workflow |

---

### Task 1: Test runner + reverse DCF (`impliedGrowth`)

**Files:**
- Create: `tools/test.js`, `tools/tests/implied-growth.test.js`
- Modify: `src/02-calculations.js` (add the function directly after `computeValuation`, before the line `// Checklist rows: PASS / FAIL / NO DATA / UNVERIFIED.`)

**Interfaces:**
- Produces: `impliedGrowth(inp) → { g: number|null, why: string|null }`. `g` is the 10-year owner-earnings growth rate at which `computeValuation({...inp, expectedGrowth: g}).dcf.valuePerShare === inp.price`, holding `discountRate` and `terminalGrowth` fixed.
- Produces: `tools/test.js` exposing a global `ctx` (the `vm` context with `src/` loaded) and `test(name, fn)` to each test file. Run: `node tools/test.js` (exit 1 on any failure).

- [ ] **Step 1: Create the test runner**

`tools/test.js`:
```js
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
```

- [ ] **Step 2: Write the failing tests**

`tools/tests/implied-growth.test.js`:
```js
// Reverse DCF: the growth rate today's price implies under Ledger's own owner-earnings DCF.
module.exports = ({ test, assert, loadApp }) => {
  const base = { price: null, netIncome: 1000, da: 200, capex: 300, expectedGrowth: 0.08, discountRate: 0.10, terminalGrowth: 0.025,
    cash: 500, totalDebt: 200, dilutedShares: 100 };

  test('round-trips: price set to DCF value at g recovers g', () => {
    const ctx = loadApp();
    for (const g of [-0.05, 0, 0.07, 0.25]) {
      const v = ctx.computeValuation({ ...base, expectedGrowth: g }).dcf.valuePerShare;
      const r = ctx.impliedGrowth({ ...base, price: v });
      assert.equal(r.why, null);
      assert.ok(Math.abs(r.g - g) < 1e-6, `expected ${g}, got ${r.g}`);
    }
  });

  test('no price → reason', () => {
    const r = loadApp().impliedGrowth({ ...base, price: null });
    assert.equal(r.g, null); assert.match(r.why, /price/);
  });

  test('owner earnings ≤ 0 → reason, not a number', () => {
    const r = loadApp().impliedGrowth({ ...base, price: 50, netIncome: -500 });
    assert.equal(r.g, null); assert.match(r.why, /owner earnings/);
  });

  test('price above the value at the top of the range → reason', () => {
    const r = loadApp().impliedGrowth({ ...base, price: 1e9 });
    assert.equal(r.g, null); assert.match(r.why, /exceeds/);
  });

  test('price below the value at the bottom of the range → reason', () => {
    const r = loadApp().impliedGrowth({ ...base, price: 0.0001, cash: 1e6 });
    assert.equal(r.g, null); assert.match(r.why, /below/);
  });

  test('discount rate ≤ terminal growth → reason', () => {
    const r = loadApp().impliedGrowth({ ...base, price: 50, discountRate: 0.02 });
    assert.equal(r.g, null); assert.match(r.why, /discount rate/);
  });
};
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node tools/test.js implied`
Expected: FAIL. All six report `ctx.impliedGrowth is not a function`.

- [ ] **Step 4: Implement `impliedGrowth`**

Insert in `src/02-calculations.js` after the closing `}` of `computeValuation`:
```js
// Reverse DCF: the 10-year owner-earnings growth rate at which Ledger's own DCF equals today's price,
// holding the discount rate and terminal growth at their current inputs. Answers "what is priced in?".
// Value per share rises monotonically with growth when owner earnings are positive, so bisection works.
const IMPLIED_G_RANGE = [-0.5, 1.0];
function impliedGrowth(inp) {
  if (!ok(inp.price) || inp.price <= 0) return { g: null, why: 'needs a current price' };
  const at = (g) => computeValuation({ ...inp, expectedGrowth: g });
  const probe = at(0);
  if (!ok(probe.ownerEarnings)) return { g: null, why: probe.why.ownerEarnings || 'owner earnings unavailable' };
  if (probe.ownerEarnings <= 0) return { g: null, why: 'owner earnings are ≤ 0, so no growth rate makes the DCF match the price' };
  if (!probe.dcf) return { g: null, why: probe.why.dcf || 'DCF not computable' };
  if (!probe.dcf.sanityOk) return { g: null, why: 'discount rate must exceed terminal growth' };
  const vps = (g) => at(g).dcf.valuePerShare;
  let [lo, hi] = IMPLIED_G_RANGE;
  if (vps(hi) < inp.price) return { g: null, why: `price exceeds the DCF value even at ${hi * 100}%/yr growth for 10 years` };
  if (vps(lo) > inp.price) return { g: null, why: `price is below the DCF value even at ${lo * 100}%/yr growth (net cash alone may exceed it)` };
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (vps(mid) < inp.price) lo = mid; else hi = mid; }
  return { g: (lo + hi) / 2, why: null };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tools/test.js implied`
Expected: `6 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add tools/test.js tools/tests/implied-growth.test.js src/02-calculations.js
git commit -m "Add test runner and reverse DCF (impliedGrowth)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: "What's priced in" panel on the stock Summary tab

**Files:**
- Modify: `src/06-render.js` (new `pricedInPanel(inp)` function placed directly above `/* ---------------- SUMMARY : STOCK ---------------- */`; call it in `renderSummaryStock` right after the verdict card)

**Interfaces:**
- Consumes: `impliedGrowth(inp)` from Task 1; existing `fmt`, `esc`, `unav`, `ok`.
- Produces: `pricedInPanel(inp) → html string`.

- [ ] **Step 1: Add the panel function**

Above `/* ---------------- SUMMARY : STOCK ---------------- */` in `src/06-render.js`:
```js
// What growth today's price already assumes (reverse DCF), next to what the company has delivered.
function pricedInPanel(inp) {
  const r = impliedGrowth(inp);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const hist = [['5-yr revenue growth', inp.revCAGR5], ['5-yr EPS growth', inp.epsCAGR5], ['Expected growth (input)', inp.expectedGrowth]];
  const body = r.g == null
    ? `<p>${unav(r.why, 'Not computable')}</p>`
    : `<p style="font-size:15px">Today's price of ${fmt.price(inp.price)} assumes owner earnings grow <b>${pct(r.g)}/yr for 10 years</b>, then ${pct(inp.terminalGrowth)} forever, discounted at ${pct(inp.discountRate)}.</p>
       <table class="data-table" style="margin-top:10px"><tbody>
         <tr class="hl"><td>Implied by price</td><td class="num">${pct(r.g)}</td></tr>
         ${hist.map(([l, v]) => `<tr><td>${l}</td><td class="num">${fmt.pct(v, 1, 'unavailable')}</td></tr>`).join('')}
       </tbody></table>`;
  return `<div class="card" style="margin-top:18px">
    <div class="card-head"><h3>What's priced in</h3><span class="card-note">reverse DCF on owner earnings</span></div>
    <div class="card-body">${body}
      <p class="note-box" style="margin-top:10px">If you believe growth will beat the implied rate, the price may be too low. If not, the good news is already in it. For cyclicals and turnarounds, today's owner earnings may be far from normal, which skews this number.</p>
    </div>
  </div>`;
}
```

- [ ] **Step 2: Call it in `renderSummaryStock`**

In `renderSummaryStock`, find the line that starts with `  <div class="card"><div class="card-body">${verdictStampBlock(val.verdict` and append `${pricedInPanel(inp)}` on the next line:
```js
  <div class="card"><div class="card-body">${verdictStampBlock(val.verdict, val.confidence, computeSummaryBottomLine(val) + (val.qualityFlag ? ' Reported earnings include one-off or non-cash items (see the warning above), so treat this verdict with extra caution.' : ''), ` · ${val.methodsEvaluated}/5 valuation methods computable · ${val.filledCount}/${val.completenessFields.length} inputs present`)}</div></div>
  ${pricedInPanel(inp)}
```

- [ ] **Step 3: Build and run tests**

Run: `node tools/build.js && node tools/test.js`
Expected: build prints `Built ledger.html …`; tests `6 passed, 0 failed`.

- [ ] **Step 4: Check in the browser**

Open `ledger.html` in the browser pane (`preview_start` with a `file://` URL, or `navigate`) and analyze `KO`. Expected: a "What's priced in" card under the verdict, showing a percentage and the three comparison rows. Then analyze a loss-maker (e.g. `INTC` if still unprofitable). Expected: "Not computable" with the owner-earnings reason.

- [ ] **Step 5: Commit**

```bash
git add src/06-render.js ledger.html
git commit -m "Add 'What's priced in' panel to stock Summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Portfolio scoring core (`scorePortfolio`)

**Files:**
- Create: `src/02-research-core.js`, `tools/tests/score.test.js`, `tools/fixtures/portfolio-fixture.json`

**Interfaces:**
- Produces: `RESEARCH_DATA` (array; the build replaces it in private mode, see Task 5). The exact source text must be `const RESEARCH_DATA = /*RESEARCH_DATA*/[]/*END_RESEARCH_DATA*/;`.
- Produces: `horizonEnd(entryDate: 'YYYY-MM-DD', horizonYears: number) → 'YYYY-MM-DD'`.
- Produces: `scorePortfolio(p, series, asOf) → Score`, where
  - `series` is `{ [symbol]: Array<{date:'YYYY-MM-DD', adj:number}> }` (ascending; must include `p.benchmark`)
  - `asOf` is `'YYYY-MM-DD'`
  - `Score` is:
    ```
    { endDate, matured: bool, days: number,
      total: { ret, benchRet, excess, maxDrawdown, benchMaxDrawdown, vol, benchVol, annRet, annBench } | null,
      why: string|null,                 // set when total is null
      positions: [{ ticker, type, weight, theme, entryPrice, ret: number|null, contribution: number|null,
                    exited: bool, approx: bool, why: string|null, status: 'intact'|'weakened'|'broken'|null }],
      curve: Array<[date, portfolioDollars, benchmarkDollars]> }   // $100k start; [] when total is null
    ```

- [ ] **Step 1: Create the fixture**

`tools/fixtures/portfolio-fixture.json`. It's TEST ONLY: invented tickers, never real research. The fingerprint is filled in Task 4. The first ten positions sum to 0.90 with `cashWeight` 0.10, and no theme exceeds 0.35.
```json
{
  "id": "TEST-FIXTURE-1y",
  "createdAt": "2026-01-02T21:00:00Z",
  "horizonYears": 1,
  "derivedFrom": null,
  "benchmark": "^SP500TR",
  "entryDate": "2026-01-02",
  "benchmarkEntry": 100,
  "snapshot": { "sp500": 6000, "treasury10y": 0.042, "notes": "TEST FIXTURE — not real research" },
  "positions": [
    { "ticker": "AAA", "type": "stock", "weight": 0.15, "entryPrice": 10, "theme": "t1", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } },
    { "ticker": "BBB", "type": "stock", "weight": 0.10, "entryPrice": 20, "theme": "t1", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } },
    { "ticker": "CCC", "type": "adr", "weight": 0.10, "entryPrice": 30, "theme": "t2", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } },
    { "ticker": "DDD", "type": "etf", "weight": 0.10, "entryPrice": 40, "theme": "t2", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } },
    { "ticker": "EEE", "type": "bond-fund", "weight": 0.05, "entryPrice": 50, "theme": "t3", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } },
    { "ticker": "FFF", "type": "stock", "weight": 0.10, "entryPrice": 60, "theme": "t3", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } },
    { "ticker": "GGG", "type": "stock", "weight": 0.10, "entryPrice": 70, "theme": "t4", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } },
    { "ticker": "HHH", "type": "stock", "weight": 0.05, "entryPrice": 80, "theme": "t4", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } },
    { "ticker": "III", "type": "stock", "weight": 0.10, "entryPrice": 90, "theme": "t5", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } },
    { "ticker": "JJJ", "type": "stock", "weight": 0.05, "entryPrice": 100, "theme": "t5", "sources": [], "thesis": { "pricedIn": "x", "consensus": "x", "variant": "x", "catalyst": "x", "killCriteria": "x" } }
  ],
  "cashWeight": 0.10,
  "researchLog": { "themes": [{ "name": "t1", "summary": "TEST" }], "rejected": [{ "ticker": "ZZZ", "reason": "TEST" }] },
  "checkIns": [],
  "fingerprint": ""
}
```

- [ ] **Step 2: Write the failing tests**

`tools/tests/score.test.js`:
```js
// scorePortfolio: buy-and-hold with drift, adjusted-close returns, 0% cash, freeze at horizon end,
// missing data → total unavailable, exits held as cash.
const fs = require('fs'); const path = require('path');
module.exports = ({ test, assert, loadApp, ROOT }) => {
  const fixture = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/portfolio-fixture.json'), 'utf8'));
  const days = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'];
  const flat = (v) => days.map(d => ({ date: d, adj: v }));
  const path_ = (vals) => days.map((d, i) => ({ date: d, adj: vals[i] }));
  const allFlat = (p) => Object.fromEntries([...p.positions.map(x => [x.ticker, flat(1)]), [p.benchmark, flat(100)]]);
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

  test('everything flat → 0 return, 0 drawdown, 0 vol', () => {
    const p = fixture(); const s = loadApp().scorePortfolio(p, allFlat(p), '2026-01-07');
    assert.equal(s.why, null); close(s.total.ret, 0, 'ret'); close(s.total.maxDrawdown, 0, 'dd'); close(s.total.vol, 0, 'vol');
    assert.equal(s.curve.length, 4); close(s.curve[0][1], 100000, 'start $');
  });

  test('one 15% position doubles, cash stays flat → +15%', () => {
    const p = fixture(); const ser = allFlat(p); ser.AAA = path_([1, 1.5, 2, 2]);
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    close(s.total.ret, 0.15, 'ret'); close(s.positions.find(x => x.ticker === 'AAA').ret, 1, 'AAA ret');
    close(s.positions.find(x => x.ticker === 'AAA').contribution, 0.15, 'AAA contribution');
  });

  test('drawdown measured from running peak', () => {
    const p = fixture(); const ser = allFlat(p); ser.AAA = path_([1, 2, 1, 1]); // +15% then back to 0
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    close(s.total.maxDrawdown, 0.15 / 1.15, 'dd');
  });

  test('benchmark return and excess', () => {
    const p = fixture(); const ser = allFlat(p); ser['^SP500TR'] = path_([100, 101, 105, 110]);
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    close(s.total.benchRet, 0.10, 'bench'); close(s.total.excess, -0.10, 'excess');
  });

  test('missing series → total null with reason naming the ticker', () => {
    const p = fixture(); const ser = allFlat(p); delete ser.CCC;
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    assert.equal(s.total, null); assert.match(s.why, /CCC/); assert.deepEqual(s.curve, []);
    assert.match(s.positions.find(x => x.ticker === 'CCC').why, /unavailable/);
  });

  test('series starting after entry date counts as missing', () => {
    const p = fixture(); const ser = allFlat(p); ser.BBB = ser.BBB.slice(2);
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    assert.equal(s.total, null); assert.match(s.why, /BBB/);
  });

  test('score freezes at horizon end', () => {
    const p = fixture(); p.horizonYears = 1;
    const d = ['2026-01-02', '2026-12-31', '2027-01-04', '2027-06-01'];
    const ser = Object.fromEntries([...p.positions.map(x => [x.ticker, d.map((date, i) => ({ date, adj: [1, 1, 2, 4][i] }))]), [p.benchmark, d.map(date => ({ date, adj: 100 }))]]);
    const s = loadApp().scorePortfolio(p, ser, '2027-06-01');
    assert.equal(s.matured, true); assert.equal(s.endDate, '2027-01-02');
    close(s.total.ret, 0, 'frozen at the 2026-12-31 value'); assert.equal(s.curve.at(-1)[0], '2026-12-31');
  });

  test('exit via check-in: value held as cash after exit date', () => {
    const p = fixture(); const ser = allFlat(p); ser.AAA = path_([1, 2, 4, 8]);
    p.checkIns = [{ date: '2026-01-05', positions: [{ ticker: 'AAA', status: 'broken', note: 'acquired', exitPrice: 20 }], summary: 'x' }];
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    close(s.total.ret, 0.15, 'held at 2x after exit'); assert.equal(s.positions.find(x => x.ticker === 'AAA').exited, true);
    assert.equal(s.positions.find(x => x.ticker === 'AAA').status, 'broken');
  });

  test('exit with no series at all uses exitPrice/entryPrice and is marked approx', () => {
    const p = fixture(); const ser = allFlat(p); delete ser.AAA;
    p.checkIns = [{ date: '2026-01-05', positions: [{ ticker: 'AAA', status: 'broken', note: 'delisted', exitPrice: 5 }], summary: 'x' }];
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    assert.notEqual(s.total, null); close(s.total.ret, -0.075, 'half of 15%');
    assert.equal(s.positions.find(x => x.ticker === 'AAA').approx, true);
  });

  test('horizonEnd adds whole years', () => {
    assert.equal(loadApp().horizonEnd('2026-10-05', 3), '2029-10-05');
  });
};
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node tools/test.js score`
Expected: FAIL with `ctx.scorePortfolio is not a function` (the file `src/02-research-core.js` doesn't exist yet).

- [ ] **Step 4: Implement `src/02-research-core.js`**

```js
/* ============================================================================
   PART 2b — RESEARCH PORTFOLIOS: data slot + scoring (pure; shared with tools/)
   Portfolios are researched in Claude Code and stored in research/portfolios.json (git-ignored).
   tools/build.js --private inlines them below; the public build always ships an empty array.
   ============================================================================ */

const RESEARCH_DATA = /*RESEARCH_DATA*/[]/*END_RESEARCH_DATA*/;

function horizonEnd(entryDate, horizonYears) {
  return `${+entryDate.slice(0, 4) + horizonYears}${entryDate.slice(4)}`;
}

// Latest point on or before `date` in an ascending [{date, adj}] series.
function pointOnOrBefore(rows, date) {
  let best = null;
  for (const r of rows) { if (r.date > date) break; best = r; }
  return best;
}

// Buy-and-hold score: weights drift with prices, dividends via adjusted close, cash at 0%,
// frozen at entryDate + horizon. A holding with no usable series makes the total unavailable.
function scorePortfolio(p, series, asOf) {
  const end = horizonEnd(p.entryDate, p.horizonYears);
  const endDate = asOf < end ? asOf : end;
  const latest = {}; // ticker → latest check-in entry
  for (const ci of p.checkIns || []) for (const e of ci.positions || []) latest[e.ticker] = { ...e, date: ci.date };
  const exitOf = (t) => (latest[t] && ok(latest[t].exitPrice) ? latest[t] : null);

  const bench = (series[p.benchmark] || []).filter(r => r.date >= p.entryDate && r.date <= endDate);
  const positions = p.positions.map(x => ({ ticker: x.ticker, type: x.type, weight: x.weight, theme: x.theme, entryPrice: x.entryPrice,
    ret: null, contribution: null, exited: !!exitOf(x.ticker), approx: false, why: null, status: latest[x.ticker]?.status ?? null }));
  const base = { endDate, matured: asOf >= end, days: Math.round(dDaysISO(endDate, p.entryDate)), positions };

  const b0 = pointOnOrBefore(series[p.benchmark] || [], p.entryDate);
  if (!b0 || !bench.length) return { ...base, total: null, why: `benchmark ${p.benchmark} prices unavailable`, curve: [] };

  // Per-position value multiple on each benchmark date (1 = entry).
  const missing = [];
  const valueFns = p.positions.map((x, i) => {
    const rows = series[x.ticker], ex = exitOf(x.ticker), pos = positions[i];
    const start = rows && pointOnOrBefore(rows, p.entryDate);
    if (!start) {
      if (ex) { pos.approx = true; const m = ex.exitPrice / x.entryPrice; return (d) => (d >= ex.date ? m : 1); }
      pos.why = 'price history unavailable'; missing.push(x.ticker); return null;
    }
    if (ex) {
      const atExit = pointOnOrBefore(rows, ex.date); const mExit = atExit ? atExit.adj / start.adj : ex.exitPrice / x.entryPrice;
      return (d) => (d >= ex.date ? mExit : (pointOnOrBefore(rows, d) || start).adj / start.adj);
    }
    return (d) => (pointOnOrBefore(rows, d) || start).adj / start.adj;
  });
  if (missing.length) return { ...base, total: null, why: `price unavailable for ${missing.join(', ')}`, curve: [] };

  const cash = p.cashWeight || 0;
  const curve = bench.map(r => {
    const v = cash + p.positions.reduce((s, x, i) => s + x.weight * valueFns[i](r.date), 0);
    return [r.date, v * 100000, (r.adj / b0.adj) * 100000];
  });
  const last = curve[curve.length - 1];
  positions.forEach((pos, i) => { const m = valueFns[i](last[0]); pos.ret = m - 1; pos.contribution = pos.weight * (m - 1); });

  const ret = last[1] / 100000 - 1, benchRet = last[2] / 100000 - 1;
  const ann = base.days >= 365 ? (r) => Math.pow(1 + r, 365.25 / base.days) - 1 : () => null;
  return { ...base, why: null, curve,
    total: { ret, benchRet, excess: ret - benchRet, maxDrawdown: maxDrawdown(curve.map(c => c[1])), benchMaxDrawdown: maxDrawdown(curve.map(c => c[2])),
      vol: annualVol(curve.map(c => c[1])), benchVol: annualVol(curve.map(c => c[2])), annRet: ann(ret), annBench: ann(benchRet) } };
}

function maxDrawdown(vals) {
  let peak = -Infinity, dd = 0;
  for (const v of vals) { peak = Math.max(peak, v); dd = Math.max(dd, 1 - v / peak); }
  return dd;
}
function annualVol(vals) {
  if (vals.length < 3) return 0;
  const r = []; for (let i = 1; i < vals.length; i++) r.push(vals[i] / vals[i - 1] - 1);
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252);
}
function dDaysISO(a, b) { return (new Date(a) - new Date(b)) / 86400000; }
```

Note: `bench` filters to dates ≥ `entryDate`. If the entry date is a holiday, the first curve point is the next trading day, and `b0` (on or before entry) remains the base.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tools/test.js score`
Expected: `10 passed, 0 failed`. If "freezes at horizon end" fails, check that `endDate` is `'2027-01-02'` and that the curve only includes benchmark dates ≤ endDate.

- [ ] **Step 6: Build and run all tests**

Run: `node tools/build.js && node tools/test.js`
Expected: build OK (`02-research-core.js` now appears in the parts list); all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/02-research-core.js tools/tests/score.test.js tools/fixtures/portfolio-fixture.json ledger.html
git commit -m "Add research portfolio scoring core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Validation, fingerprint, Yahoo helpers (Node library)

**Files:**
- Create: `tools/research-lib.js`, `tools/tests/validate.test.js`
- Modify: `tools/fixtures/portfolio-fixture.json` (fill `fingerprint`), `.gitignore`

**Interfaces:**
- Produces (`require('./research-lib')`):
  - `fingerprint(p) → string` (hex sha256 of the immutable core)
  - `validatePortfolio(p) → string[]` (empty when valid)
  - `validateAll(list) → string[]` (per-portfolio errors prefixed with id, plus duplicate ids and dangling `derivedFrom`)
  - `loadPortfolios() → array` (`[]` if `research/portfolios.json` is absent)
  - `savePortfolios(list)`
  - `yahooSeries(symbol, fromISO) → Promise<{rows:[{date, close, adj}], meta}>` (direct Yahoo, Node only)
  - `RESEARCH_FILE`, `CONFIG_FILE` path constants

- [ ] **Step 1: Write the failing tests**

`tools/tests/validate.test.js`:
```js
const fs = require('fs'); const path = require('path');
module.exports = ({ test, assert, ROOT }) => {
  const lib = require(path.join(ROOT, 'tools/research-lib.js'));
  const fixture = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/portfolio-fixture.json'), 'utf8'));
  const valid = () => { const p = fixture(); p.fingerprint = lib.fingerprint(p); return p; };

  test('fixture is valid once fingerprinted', () => assert.deepEqual(lib.validatePortfolio(valid()), []));
  test('committed fixture fingerprint is current', () => assert.equal(fixture().fingerprint, lib.fingerprint(fixture())));

  test('fingerprint ignores check-ins and research log, covers weights and prices', () => {
    const a = valid(), b = valid();
    b.checkIns.push({ date: '2026-02-01', positions: [], summary: 'x' }); b.researchLog.themes = [];
    assert.equal(lib.fingerprint(a), lib.fingerprint(b));
    b.positions[0].entryPrice = 11; assert.notEqual(lib.fingerprint(a), lib.fingerprint(b));
  });

  test('edited entry price fails validation', () => {
    const p = valid(); p.positions[0].entryPrice = 11;
    assert.ok(lib.validatePortfolio(p).some(e => /fingerprint/.test(e)));
  });

  const broken = (mutate, re) => () => { const p = fixture(); mutate(p); p.fingerprint = lib.fingerprint(p); assert.ok(lib.validatePortfolio(p).some(e => re.test(e)), `expected ${re}`); };
  test('too few positions', broken(p => { p.positions = p.positions.slice(0, 9); p.cashWeight = 1 - p.positions.reduce((s, x) => s + x.weight, 0); }, /10–20 positions/));
  test('weight over 15%', broken(p => { p.positions[0].weight = 0.2; p.cashWeight = 0.05; }, /15%/));
  test('weights not summing to 1', broken(p => { p.cashWeight = 0.2; }, /sum/));
  test('theme over 35%', broken(p => { p.positions[2].theme = 't1'; p.positions[3].theme = 't1'; }, /theme t1/));
  test('missing thesis field', broken(p => { p.positions[0].thesis.variant = ''; }, /variant/));
  test('bad type', broken(p => { p.positions[0].type = 'option'; }, /type/));
  test('duplicate ticker', broken(p => { p.positions[1].ticker = 'AAA'; }, /duplicate/));
  test('horizon out of range', broken(p => { p.horizonYears = 6; }, /horizonYears/));
  test('bad check-in status', broken(p => { p.checkIns = [{ date: '2026-02-01', positions: [{ ticker: 'AAA', status: 'meh', note: '' }], summary: '' }]; }, /status/));
  test('check-in for unknown ticker', broken(p => { p.checkIns = [{ date: '2026-02-01', positions: [{ ticker: 'NOPE', status: 'intact', note: '' }], summary: '' }]; }, /NOPE/));
  test('check-in before entry', broken(p => { p.checkIns = [{ date: '2025-12-01', positions: [], summary: '' }]; }, /before entry/));

  test('validateAll catches duplicate ids and dangling derivedFrom', () => {
    const a = valid(), b = valid(); const c = valid(); c.id = 'X'; c.derivedFrom = 'MISSING'; c.fingerprint = lib.fingerprint(c);
    const errs = lib.validateAll([a, b, c]);
    assert.ok(errs.some(e => /duplicate id/.test(e))); assert.ok(errs.some(e => /derivedFrom/.test(e)));
  });
};
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tools/test.js validate`
Expected: FAIL with `Cannot find module '.../tools/research-lib.js'`.

- [ ] **Step 3: Implement `tools/research-lib.js`**

```js
// Node-only helpers for research portfolios: integrity fingerprint, validation, storage, Yahoo prices.
// The app never needs these; the build, record/check-in scripts and tests do.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const RESEARCH_FILE = path.join(ROOT, 'research', 'portfolios.json');
const CONFIG_FILE = path.join(ROOT, 'research', 'config.json');
const TYPES = new Set(['stock', 'etf', 'adr', 'bond-fund']);
const STATUSES = new Set(['intact', 'weakened', 'broken']);
const THESIS = ['pricedIn', 'consensus', 'variant', 'catalyst', 'killCriteria'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Everything that must never change after creation. Check-ins and the research log are excluded.
function fingerprint(p) {
  const core = { id: p.id, entryDate: p.entryDate, horizonYears: p.horizonYears, benchmark: p.benchmark, benchmarkEntry: p.benchmarkEntry,
    cashWeight: p.cashWeight, positions: p.positions.map(x => [x.ticker, x.type, x.weight, x.entryPrice]) };
  return crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
}

function validatePortfolio(p) {
  const e = [];
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!str(p.id)) e.push('id missing');
  if (!str(p.createdAt)) e.push('createdAt missing');
  if (!Number.isInteger(p.horizonYears) || p.horizonYears < 1 || p.horizonYears > 5) e.push('horizonYears must be an integer 1–5');
  if (!ISO.test(p.entryDate || '')) e.push('entryDate must be YYYY-MM-DD');
  if (p.benchmark !== '^SP500TR') e.push('benchmark must be ^SP500TR');
  if (!(p.benchmarkEntry > 0)) e.push('benchmarkEntry must be > 0');
  const pos = Array.isArray(p.positions) ? p.positions : [];
  if (pos.length < 10 || pos.length > 20) e.push(`needs 10–20 positions (has ${pos.length})`);
  const seen = new Set(), themes = {};
  for (const x of pos) {
    const t = x.ticker || '?';
    if (!/^[A-Z0-9.\-^]{1,12}$/.test(t)) e.push(`${t}: bad ticker`);
    if (seen.has(t)) e.push(`${t}: duplicate ticker`); seen.add(t);
    if (!TYPES.has(x.type)) e.push(`${t}: type must be one of ${[...TYPES].join(', ')}`);
    if (!(x.weight > 0 && x.weight <= 0.15 + 1e-9)) e.push(`${t}: weight must be > 0 and ≤ 15%`);
    if (!(x.entryPrice > 0)) e.push(`${t}: entryPrice must be > 0`);
    if (!str(x.theme)) e.push(`${t}: theme missing`); else themes[x.theme] = (themes[x.theme] || 0) + (x.weight || 0);
    for (const f of THESIS) if (!str(x.thesis?.[f])) e.push(`${t}: thesis.${f} missing`);
    if (!Array.isArray(x.sources)) e.push(`${t}: sources must be an array`);
  }
  for (const [th, w] of Object.entries(themes)) if (w > 0.35 + 1e-9) e.push(`theme ${th} is ${(w * 100).toFixed(1)}% (max 35%)`);
  const cash = p.cashWeight;
  if (!(cash >= 0 && cash <= 1)) e.push('cashWeight must be 0–1');
  const sum = pos.reduce((s, x) => s + (x.weight || 0), 0) + (cash || 0);
  if (Math.abs(sum - 1) > 0.001) e.push(`weights + cash sum to ${sum.toFixed(4)}, must be 1`);
  for (const ci of p.checkIns || []) {
    if (!ISO.test(ci.date || '')) { e.push('check-in date must be YYYY-MM-DD'); continue; }
    if (ci.date < p.entryDate) e.push(`check-in ${ci.date} is before entry`);
    for (const c of ci.positions || []) {
      if (!seen.has(c.ticker)) e.push(`check-in ${ci.date}: ${c.ticker} is not a position`);
      if (!STATUSES.has(c.status)) e.push(`check-in ${ci.date}: ${c.ticker} status must be intact, weakened or broken`);
      if (c.exitPrice != null && !(c.exitPrice > 0)) e.push(`check-in ${ci.date}: ${c.ticker} exitPrice must be > 0`);
    }
  }
  if (p.fingerprint !== fingerprint(p)) e.push('fingerprint mismatch — positions, weights, prices or dates were edited after creation');
  return e;
}

function validateAll(list) {
  const e = [], ids = new Set();
  for (const p of list) {
    if (ids.has(p.id)) e.push(`duplicate id ${p.id}`); ids.add(p.id);
    for (const msg of validatePortfolio(p)) e.push(`${p.id}: ${msg}`);
  }
  for (const p of list) if (p.derivedFrom != null && !ids.has(p.derivedFrom)) e.push(`${p.id}: derivedFrom ${p.derivedFrom} not found`);
  return e;
}

function loadPortfolios() { return fs.existsSync(RESEARCH_FILE) ? JSON.parse(fs.readFileSync(RESEARCH_FILE, 'utf8')) : []; }
function savePortfolios(list) { fs.mkdirSync(path.dirname(RESEARCH_FILE), { recursive: true }); fs.writeFileSync(RESEARCH_FILE, JSON.stringify(list, null, 2) + '\n'); }

// Daily closes + adjusted closes from fromISO to today, straight from Yahoo (Node has no CORS limits).
async function yahooSeries(symbol, fromISO) {
  const p1 = Math.floor(new Date(fromISO).getTime() / 1000) - 7 * 86400, p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const r = (await res.json())?.chart?.result?.[0];
      if (!r?.timestamp) throw new Error(`no Yahoo data for ${symbol}`);
      const q = r.indicators.quote[0], adj = r.indicators.adjclose?.[0]?.adjclose || [];
      const rows = r.timestamp.map((t, k) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: q.close[k], adj: adj[k] ?? q.close[k] })).filter(x => x.close != null);
      return { rows, meta: r.meta };
    }
    await new Promise(ok => setTimeout(ok, 1500 * (i + 1)));
  }
  throw new Error(`Yahoo request failed for ${symbol}`);
}

module.exports = { fingerprint, validatePortfolio, validateAll, loadPortfolios, savePortfolios, yahooSeries, RESEARCH_FILE, CONFIG_FILE, ROOT };
```

- [ ] **Step 4: Fill the fixture's fingerprint**

Run:
```bash
node -e "const l=require('./tools/research-lib');const f='tools/fixtures/portfolio-fixture.json';const p=require('./'+f);p.fingerprint=l.fingerprint(p);require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tools/test.js`
Expected: all tests pass (implied, score and 16 validate tests).

- [ ] **Step 6: Git-ignore research data and the private build**

Append to `.gitignore`:
```
# Research portfolios are private: never commit them or the build that contains them
research/
ledger.private.html
```

- [ ] **Step 7: Commit**

```bash
git add tools/research-lib.js tools/tests/validate.test.js tools/fixtures/portfolio-fixture.json .gitignore
git commit -m "Add research portfolio validation and integrity fingerprint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Private and public builds + Google Drive copy

**Files:**
- Modify: `tools/build.js`
- Create: `tools/tests/build.test.js`

**Interfaces:**
- Consumes: `validateAll`, `loadPortfolios`, `CONFIG_FILE` from Task 4; the `RESEARCH_DATA` placeholder from Task 3.
- Produces: `require('./build').assemble({ research: array|null }) → html string`. Throws if the placeholder is missing, or if `research` is null and the placeholder isn't exactly `[]`.
- CLI:
  - `node tools/build.js` → public `ledger.html`
  - `node tools/build.js --private` → `ledger.private.html` plus a copy to `<shareDir>/ledger.html` when `research/config.json` has `shareDir`

- [ ] **Step 1: Write the failing tests**

`tools/tests/build.test.js`:
```js
const fs = require('fs'); const path = require('path');
module.exports = ({ test, assert, ROOT }) => {
  const { assemble } = require(path.join(ROOT, 'tools/build.js'));
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/portfolio-fixture.json'), 'utf8'));

  test('public build ships an empty research array', () => {
    const html = assemble({ research: null });
    assert.ok(html.includes('/*RESEARCH_DATA*/[]/*END_RESEARCH_DATA*/'));
    assert.ok(!html.includes('TEST-FIXTURE'));
  });
  test('private build inlines the portfolios', () => {
    const html = assemble({ research: [fixture] });
    assert.ok(html.includes('"TEST-FIXTURE-1y"'));
    assert.ok(!html.includes('/*RESEARCH_DATA*/[]/*END_RESEARCH_DATA*/'));
  });
  test('private build escapes </script> inside research text', () => {
    const p = JSON.parse(JSON.stringify(fixture)); p.researchLog.themes[0].summary = '</script><b>x';
    const html = assemble({ research: [p] });
    assert.equal((html.match(/<\/script>/g) || []).length, 1);
  });
  test('committed ledger.html contains no research data', () => {
    const html = fs.readFileSync(path.join(ROOT, 'ledger.html'), 'utf8');
    assert.ok(html.includes('/*RESEARCH_DATA*/[]/*END_RESEARCH_DATA*/'));
  });
};
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tools/test.js build`
Expected: FAIL with `assemble is not a function` (build.js runs immediately and exports nothing).

- [ ] **Step 3: Rewrite `tools/build.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/build.js && node tools/test.js`
Expected: `Built ledger.html (… public — no research data)`; all tests pass.

- [ ] **Step 5: Try the private build with the fixture (without touching real research)**

Run:
```bash
mkdir -p research && [ ! -f research/portfolios.json ] && node -e "require('fs').writeFileSync('research/portfolios.json', JSON.stringify([require('./tools/fixtures/portfolio-fixture.json')],null,2))" && node tools/build.js --private && grep -c TEST-FIXTURE ledger.private.html; rm -f research/portfolios.json
```
Expected: `Built ledger.private.html … with 1 research portfolio(s)` and a count ≥ 1. The temporary file is removed afterwards. Only run this when `research/portfolios.json` doesn't exist yet; the `[ ! -f … ]` guard enforces that.

- [ ] **Step 6: Commit**

```bash
git add tools/build.js tools/tests/build.test.js
git commit -m "Build: public build excludes research; --private inlines it and copies to Drive

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Record, check-in and score CLIs

**Files:**
- Create: `tools/record-portfolio.js`, `tools/add-checkin.js`, `tools/score-portfolios.js`

**Interfaces:**
- Consumes: `research-lib` (Task 4); `scorePortfolio`, `horizonEnd` from `src/02-research-core.js` (Task 3), loaded via `vm`.
- CLI contracts:
  - `node tools/record-portfolio.js research/drafts/<file>.json [--date YYYY-MM-DD]`
    - The draft has every portfolio field **except** `entryPrice` (per position), `entryDate`, `benchmarkEntry`, `createdAt`, `checkIns`, `fingerprint`.
    - The script fetches closes, fills those fields, validates, appends, and runs `build.js --private`.
    - It refuses if the id exists, or if any ticker has no close on the entry date.
  - `node tools/add-checkin.js <portfolioId> research/drafts/<checkin>.json`
    - The check-in file is `{ date, positions: [{ ticker, status, note, exitPrice? }], summary }`.
    - The script appends, validates, and builds privately.
  - `node tools/score-portfolios.js [id]` prints the score table for all or one portfolio.

- [ ] **Step 1: Write `tools/record-portfolio.js`**

```js
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
```

- [ ] **Step 2: Write `tools/add-checkin.js`**

```js
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
```

- [ ] **Step 3: Write `tools/score-portfolios.js`**

```js
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

(async () => {
  const only = process.argv[2];
  const list = lib.loadPortfolios().filter(p => !only || p.id === only);
  if (!list.length) { console.log(only ? `no portfolio ${only}` : 'no portfolios in research/portfolios.json'); return; }
  const today = new Date().toISOString().slice(0, 10);
  const cache = {};
  const get = async (sym, from) => (cache[sym] ||= await lib.yahooSeries(sym, from).then(s => s.rows).catch(() => null));
  for (const p of list) {
    const series = {};
    for (const sym of [p.benchmark, ...p.positions.map(x => x.ticker)]) { const r = await get(sym, p.entryDate); if (r) series[sym] = r; }
    const s = ctx.scorePortfolio(p, series, today);
    console.log(`\n${p.id}  (${p.horizonYears}-yr, entry ${p.entryDate}, ${s.matured ? 'MATURED' : `day ${s.days}`})`);
    if (!s.total) { console.log(`  total unavailable: ${s.why}`); continue; }
    const t = s.total;
    console.log(`  portfolio ${pct(t.ret)}   S&P ${pct(t.benchRet)}   excess ${pct(t.excess)}   max DD ${pct(t.maxDrawdown)} vs ${pct(t.benchMaxDrawdown)}   vol ${pct(t.vol)} vs ${pct(t.benchVol)}`);
    for (const x of [...s.positions].sort((a, b) => b.contribution - a.contribution))
      console.log(`    ${x.ticker.padEnd(7)} ${pct(x.weight)} ret ${pct(x.ret)} contrib ${pct(x.contribution)}${x.status ? `  [${x.status}]` : ''}${x.exited ? ' exited' : ''}${x.approx ? ' (approx)' : ''}`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 4: Smoke-test with the fixture's real-ticker twin (no real research written)**

Run:
```bash
mkdir -p "$TMPDIR/ledger-smoke" && node -e "
const p=require('./tools/fixtures/portfolio-fixture.json');
const real=['AAPL','MSFT','KO','JNJ','VOO','BND','TSM','XOM','WMT','NKE'];
p.positions.forEach((x,i)=>x.ticker=real[i]); p.id='SMOKE-TEST';
for (const k of ['entryDate','benchmarkEntry','createdAt','checkIns','fingerprint']) delete p[k];
p.positions.forEach(x=>delete x.entryPrice);
require('fs').writeFileSync(process.env.TMPDIR+'/ledger-smoke/draft.json',JSON.stringify(p));"
cp research/portfolios.json "$TMPDIR/ledger-smoke/backup.json" 2>/dev/null; true
```
Then run `node tools/record-portfolio.js "$TMPDIR/ledger-smoke/draft.json"` and `node tools/score-portfolios.js SMOKE-TEST`.

Expected: `Recorded SMOKE-TEST: 10 positions …`, a private build line, and a score block with near-zero returns, since entry is today.

Then restore: `cp "$TMPDIR/ledger-smoke/backup.json" research/portfolios.json 2>/dev/null || rm -f research/portfolios.json`, then `node tools/build.js --private 2>/dev/null; true`.

- [ ] **Step 5: Commit**

```bash
git add tools/record-portfolio.js tools/add-checkin.js tools/score-portfolios.js
git commit -m "Add record, check-in and score CLIs for research portfolios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Research view — shell, list and scoreboard

**Files:**
- Modify: `src/01-head.html`, `src/05-data-and-flow.js`, `src/07-events.js`
- Create: `src/06-render-research.js`

**Interfaces:**
- Consumes:
  - `RESEARCH_DATA`, `scorePortfolio`, `horizonEnd` (Task 3)
  - the existing `Net.json`, `esc`, `fmt`, `unav`, `ok`
- Produces:
  - `fetchAdjSeries(symbol, fromISO) → Promise<[{date, adj}]|null>`: quiet (no fetch-log lines), cached in memory for the session, via the relay.
  - `openResearch()`, `closeResearch()`, `renderResearch()`.
  - `AppState.research = { view: 'list'|'detail', id: null, filter: 0, scores: {}, loading: false }`.
  - DOM:
    - `#researchBtn` (header)
    - `#researchView` (section; hidden by default)
    - `data-action` values: `research-close`, `research-open:<id>`, `research-filter:<n>`, `research-back`, `research-ledger:<ticker>:<type>`, `research-toggle:<ticker>`, `research-rescore`

- [ ] **Step 1: Add the button, section and styles to `src/01-head.html`**

After the line containing `id="keysBtn"`, add:
```html
        <button type="button" id="researchBtn" class="btn sm keys-btn">Research</button>
```
Before `<div id="mainApp" hidden>`, add:
```html
  <section id="researchView" class="tab-content" hidden></section>
```
In the `<style>` block, after the `.data-table tr.hl td{…}` rule, add:
```css
.research-banner{background:rgba(201,161,90,.08); border:1px solid var(--border-strong); border-radius:var(--radius-lg); padding:10px 14px; font-size:13px; color:var(--ink-dim); margin-bottom:16px}
.research-cards{display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px}
.research-card{text-align:left; cursor:pointer; padding:14px 16px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); color:var(--ink)}
.research-card:hover{border-color:var(--brass)}
.research-card .rc-ret{font-family:var(--font-mono); font-size:20px; margin-top:6px}
.research-card .rc-sub{font-size:12px; color:var(--ink-faint)}
.pos-up{color:var(--good, #6fbf8e)} .pos-down{color:var(--bad, #d46a5f)}
.thesis-row td{background:rgba(255,255,255,.02); font-size:13px}
.thesis-row dl{display:grid; grid-template-columns:max-content 1fr; gap:4px 14px; margin:0}
.thesis-row dt{color:var(--ink-faint); font-size:11px; text-transform:uppercase; letter-spacing:.05em}
```

- [ ] **Step 2: Add `fetchAdjSeries` to `src/05-data-and-flow.js`**

Directly after the `fetchBenchmark` function:
```js
// Quiet daily adjusted-close series for research scoring (no fetch-log lines). Cached per session.
const _adjCache = new Map();
async function fetchAdjSeries(symbol, fromISO) {
  const key = `${symbol}|${fromISO}`;
  if (_adjCache.has(key)) return _adjCache.get(key);
  const p1 = Math.floor(new Date(fromISO).getTime() / 1000) - 7 * 86400, p2 = Math.floor(Date.now() / 1000) + 86400;
  const job = Net.json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`, { relay: true, retries: 1 })
    .then(data => {
      const r = data?.chart?.result?.[0]; if (!r?.timestamp) return null;
      const q = r.indicators?.quote?.[0] || {}, adj = r.indicators?.adjclose?.[0]?.adjclose || [];
      const rows = [];
      r.timestamp.forEach((t, i) => { const c = ok(adj[i]) ? adj[i] : q.close?.[i]; if (ok(c)) rows.push({ date: new Date(t * 1000).toISOString().slice(0, 10), adj: c }); });
      return rows.length ? rows : null;
    }).catch(() => null);
  _adjCache.set(key, job);
  return job;
}
```

- [ ] **Step 3: Create `src/06-render-research.js` (list view)**

```js
/* ============================================================================
   PART 6b — RESEARCH VIEW: hypothetical portfolios, scored live against the S&P 500 TR
   ============================================================================ */

AppState.research = { view: 'list', id: null, filter: 0, scores: {}, loading: false };
const RESEARCH_BANNER = `<div class="research-banner"><b>Hypothetical research portfolios — not investment advice.</b> Each portfolio was frozen when it was created and is scored buy-and-hold against the S&P 500 total-return index, dividends included. Cash earns 0%.</div>`;

function openResearch() {
  for (const id of ['emptyState', 'mainApp', 'watchlistStrip']) document.getElementById(id).hidden = true;
  document.getElementById('researchView').hidden = false;
  AppState.research.view = 'list'; renderResearch(); scoreAllResearch();
}
function closeResearch() {
  document.getElementById('researchView').hidden = true;
  document.getElementById(AppState.ticker ? 'mainApp' : 'emptyState').hidden = false;
  if (AppState.watchlist?.length) document.getElementById('watchlistStrip').hidden = false;
}

// Fetch every symbol the portfolios need (2 at a time, to stay under the free relay's rate limit), then score.
async function scoreAllResearch() {
  const R = AppState.research; if (R.loading || !RESEARCH_DATA.length) return;
  R.loading = true; renderResearch();
  const today = new Date().toISOString().slice(0, 10);
  const jobs = []; const series = {};
  for (const p of RESEARCH_DATA) for (const sym of [p.benchmark, ...p.positions.map(x => x.ticker)]) jobs.push([sym, p.entryDate]);
  const queue = [...new Map(jobs.map(j => [j.join('|'), j])).values()];
  const worker = async () => { while (queue.length) { const [sym, from] = queue.shift(); series[`${sym}|${from}`] = await fetchAdjSeries(sym, from); } };
  await Promise.all([worker(), worker()]);
  for (const p of RESEARCH_DATA) {
    const s = {}; for (const sym of [p.benchmark, ...p.positions.map(x => x.ticker)]) { const rows = series[`${sym}|${p.entryDate}`]; if (rows) s[sym] = rows; }
    R.scores[p.id] = scorePortfolio(p, s, today);
  }
  R.loading = false; renderResearch();
}

const signedPct = (x, dp = 1) => (ok(x) ? `<span class="${x >= 0 ? 'pos-up' : 'pos-down'}">${x >= 0 ? '+' : ''}${(x * 100).toFixed(dp)}%</span>` : unav('n/a'));

function renderResearch() {
  const el = document.getElementById('researchView'); if (!el) return;
  const R = AppState.research;
  el.innerHTML = RESEARCH_BANNER + (R.view === 'detail' ? renderResearchDetail(RESEARCH_DATA.find(p => p.id === R.id)) : renderResearchList());
  if (R.view === 'detail') mountResearchChart();
}

function renderResearchList() {
  const R = AppState.research;
  const head = `<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px">
    <h2 style="margin:0">Research portfolios</h2>
    <div style="display:flex; gap:6px; flex-wrap:wrap">
      ${[0, 1, 2, 3, 4, 5].map(n => `<button type="button" class="range-btn ${R.filter === n ? 'is-active' : ''}" data-action="research-filter:${n}">${n ? `${n}-yr` : 'All'}</button>`).join('')}
      <button type="button" class="btn sm" data-action="research-rescore">${R.loading ? 'Scoring…' : 'Refresh prices'}</button>
      <button type="button" class="btn sm" data-action="research-close">Back to analysis</button>
    </div></div>`;
  if (!RESEARCH_DATA.length) return head + `<div class="card"><div class="card-body"><p>No research portfolios in this copy of Ledger.</p><p class="note-box">Portfolios are created in Claude Code and kept private. They appear only in the private build (<code>ledger.private.html</code>) or the copy shared to you. The public site never includes them.</p></div></div>`;
  const list = RESEARCH_DATA.filter(p => !R.filter || p.horizonYears === R.filter).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const scored = list.map(p => R.scores[p.id]).filter(s => s?.total);
  const beat = scored.filter(s => s.total.excess > 0).length;
  const avgEx = scored.length ? scored.reduce((a, s) => a + s.total.excess, 0) / scored.length : null;
  const board = `<div class="stat-row">
    <div class="stat-cell"><div class="stat-label">Portfolios</div><div class="stat-value">${list.length}</div></div>
    <div class="stat-cell"><div class="stat-label">Beating the S&amp;P</div><div class="stat-value">${scored.length ? `${beat} of ${scored.length}` : R.loading ? '…' : unav('no scores yet')}</div></div>
    <div class="stat-cell"><div class="stat-label">Average excess return</div><div class="stat-value">${avgEx == null ? (R.loading ? '…' : unav('no scores yet')) : signedPct(avgEx)}</div></div>
    <div class="stat-cell"><div class="stat-label">Matured</div><div class="stat-value">${list.filter(p => R.scores[p.id]?.matured).length}</div></div>
  </div>`;
  const card = (p) => {
    const s = R.scores[p.id];
    const months = Math.max(0, Math.floor((s?.days ?? 0) / 30.44));
    const status = s?.matured ? 'matured' : p.derivedFrom ? `derived from ${esc(p.derivedFrom)}` : 'active';
    return `<button type="button" class="research-card" data-action="research-open:${esc(p.id)}">
      <div class="rc-sub">${esc(p.entryDate)} · ${p.horizonYears}-yr · month ${months} of ${p.horizonYears * 12} · ${status}</div>
      <div><b>${esc(p.id)}</b></div>
      <div class="rc-ret">${s?.total ? signedPct(s.total.excess) : R.loading ? '…' : unav(s?.why || 'not scored')}</div>
      <div class="rc-sub">${s?.total ? `vs S&amp;P · portfolio ${signedPct(s.total.ret)} / S&amp;P ${signedPct(s.total.benchRet)}` : ''}</div>
    </button>`;
  };
  return head + board + `<div class="research-cards">${list.map(card).join('')}</div>`;
}

// Detail view and chart are added in Task 8.
function renderResearchDetail(p) { return p ? `<p>${esc(p.id)}</p>` : '<p>Portfolio not found.</p>'; }
function mountResearchChart() {}
```

- [ ] **Step 4: Wire events in `src/07-events.js`**

After the `document.getElementById('keysBtn').addEventListener(...)` block, add:
```js
// ---- Research view ----
document.getElementById('researchBtn').addEventListener('click', openResearch);
document.getElementById('researchView').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action; if (!a) return;
  const R = AppState.research;
  const [cmd, ...rest] = a.split(':'); const arg = rest.join(':');
  if (cmd === 'research-close') closeResearch();
  else if (cmd === 'research-filter') { R.filter = +arg; renderResearch(); }
  else if (cmd === 'research-open') { R.view = 'detail'; R.id = arg; R.open = null; renderResearch(); window.scrollTo(0, 0); }
  else if (cmd === 'research-back') { R.view = 'list'; renderResearch(); }
  else if (cmd === 'research-rescore') { R.scores = {}; _adjCache.clear(); scoreAllResearch(); }
  else if (cmd === 'research-toggle') { R.open = R.open === arg ? null : arg; renderResearch(); }
  else if (cmd === 'research-ledger') {
    const [ticker, type] = rest; closeResearch();
    const at = type === 'etf' || type === 'bond-fund' ? 'fund' : 'stock';
    setAssetType(at); document.getElementById('tickerInput').value = ticker; analyzeTicker(ticker, at);
  }
});
```

Also, in `analyzeTicker`'s path that un-hides `mainApp` (and in the watchlist chip handler), the research view must hide. Add this as the first line inside `analyzeTicker` in `src/05-data-and-flow.js` (before `const ticker = normalizeTicker(rawTicker);`):
```js
  document.getElementById('researchView').hidden = true;
```

- [ ] **Step 5: Build, test, and check in the browser with the fixture**

Run: `node tools/build.js && node tools/test.js`
Expected: build OK; all tests pass. In the build parts list, `06-render-research.js` appears before `06-render.js`. That ordering is fine, because everything in it is a function or runs only on click, except `AppState.research = …`. `AppState` is defined in `05-data-and-flow.js`, which comes earlier.

UI check: the fixture uses invented tickers, so prices won't load. That's expected, and it exercises the "unavailable" path. Run:
```bash
node -e "const {assemble}=require('./tools/build');require('fs').writeFileSync(process.env.TMPDIR+'/ledger-fixture.html',assemble({research:[require('./tools/fixtures/portfolio-fixture.json')]}))"
```
Open `file://$TMPDIR/ledger-fixture.html` in the browser pane and click **Research**. Expected:
- the banner, a scoreboard showing 1 portfolio, and a card for `TEST-FIXTURE-1y` whose return shows "Unavailable" with "price unavailable for AAA, …"
- "Back to analysis" returns to the empty state

Also open the public `ledger.html` and click Research. Expected: the "No research portfolios in this copy" message.

- [ ] **Step 6: Commit**

```bash
git add src/01-head.html src/05-data-and-flow.js src/06-render-research.js src/07-events.js ledger.html
git commit -m "Add Research view with portfolio list and scoreboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Research view — portfolio detail and comparison chart

**Files:**
- Modify: `src/06-render-research.js` (replace the two placeholder functions at the bottom)

**Interfaces:**
- Consumes: `AppState.research` (`scores`, `open`), `Score` from Task 3, action names from Task 7.
- Produces: `renderResearchDetail(p) → html`, `mountResearchChart()` (draws into `#researchChart`).

- [ ] **Step 1: Replace the placeholders with the detail view**

Replace the last three lines of `src/06-render-research.js` (from `// Detail view and chart are added in Task 8.` to the end) with:
```js
function renderResearchDetail(p) {
  const R = AppState.research;
  if (!p) return `<p>Portfolio not found.</p><button type="button" class="btn sm" data-action="research-back">All portfolios</button>`;
  const s = R.scores[p.id], t = s?.total;
  const stat = (label, v, sub = '') => `<div class="stat-cell"><div class="stat-label">${label}</div><div class="stat-value">${v}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const plain = (x) => (ok(x) ? `${(x * 100).toFixed(1)}%` : unav('n/a'));
  const waiting = R.loading ? '…' : unav(s?.why || 'not scored yet');
  const head = `<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px">
      <div><h2 style="margin:0">${esc(p.id)}</h2><div class="rc-sub">${p.horizonYears}-yr horizon · entry ${esc(p.entryDate)} · ends ${esc(horizonEnd(p.entryDate, p.horizonYears))}${p.derivedFrom ? ` · derived from ${esc(p.derivedFrom)}` : ''}${s?.matured ? ' · <b>matured</b>' : ''}</div></div>
      <div style="display:flex; gap:6px"><button type="button" class="btn sm" data-action="research-rescore">${R.loading ? 'Scoring…' : 'Refresh prices'}</button><button type="button" class="btn sm" data-action="research-back">All portfolios</button></div>
    </div>`;
  const stats = `<div class="stat-row">
      ${stat('Portfolio', t ? signedPct(t.ret) : waiting, t?.annRet != null ? `${signedPct(t.annRet)}/yr` : '')}
      ${stat('S&amp;P 500 TR', t ? signedPct(t.benchRet) : waiting, t?.annBench != null ? `${signedPct(t.annBench)}/yr` : '')}
      ${stat('Excess', t ? signedPct(t.excess) : waiting)}
      ${stat('Worst drop / volatility', t ? `${plain(t.maxDrawdown)} / ${plain(t.vol)}` : waiting, t ? `S&amp;P ${plain(t.benchMaxDrawdown)} / ${plain(t.benchVol)}` : '')}
    </div>`;
  const chart = `<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>$100,000: portfolio vs. S&amp;P 500 TR</h3></div>
      <div class="card-body">${t && s.curve.length >= 2 ? `<div id="researchChart" style="height:240px"></div>` : (R.loading ? '<p>Loading prices…</p>' : unav(s?.why || 'not enough price history yet'))}</div></div>`;
  const posScore = Object.fromEntries((s?.positions || []).map(x => [x.ticker, x]));
  const dot = (st) => (st ? `<span class="pill ${st === 'intact' ? 'good' : st === 'broken' ? 'bad' : 'watch'}">${st}</span>` : '');
  const rows = [...p.positions].sort((a, b) => b.weight - a.weight).map(x => {
    const sc = posScore[x.ticker] || {};
    const hist = (p.checkIns || []).flatMap(ci => (ci.positions || []).filter(c => c.ticker === x.ticker).map(c => `<li>${esc(ci.date)} · ${esc(c.status)}${ok(c.exitPrice) ? ` · exited at ${fmt.price(c.exitPrice)}` : ''} — ${esc(c.note || '')}</li>`));
    const open = R.open === x.ticker ? `<tr class="thesis-row"><td colspan="7"><dl>
        <dt>Priced in</dt><dd>${esc(x.thesis.pricedIn)}</dd><dt>Market view</dt><dd>${esc(x.thesis.consensus)}</dd>
        <dt>Our view</dt><dd>${esc(x.thesis.variant)}</dd><dt>Trigger</dt><dd>${esc(x.thesis.catalyst)}</dd><dt>Exit rule</dt><dd>${esc(x.thesis.killCriteria)}</dd>
        <dt>Theme</dt><dd>${esc(x.theme)}</dd>
        <dt>Sources</dt><dd>${x.sources.length ? x.sources.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a>`).join('<br>') : 'none recorded'}</dd>
        <dt>Check-ins</dt><dd>${hist.length ? `<ul style="margin:0; padding-left:18px">${hist.join('')}</ul>` : 'none yet'}</dd>
      </dl><p style="margin-top:8px"><button type="button" class="btn sm" data-action="research-ledger:${esc(x.ticker)}:${esc(x.type)}">Open ${esc(x.ticker)} in Ledger</button></p></td></tr>` : '';
    return `<tr style="cursor:pointer" data-action="research-toggle:${esc(x.ticker)}">
        <td><b>${esc(x.ticker)}</b> <span class="rc-sub">${esc(x.type)}</span></td><td class="num">${(x.weight * 100).toFixed(1)}%</td>
        <td class="num">${fmt.usd(x.weight * 100000, { abbreviate: false, decimals: 0 })}</td><td class="num">${fmt.price(x.entryPrice)}</td>
        <td class="num">${sc.ret != null ? signedPct(sc.ret) : unav(sc.why || (R.loading ? '…' : 'n/a'))}</td>
        <td class="num">${sc.contribution != null ? signedPct(sc.contribution, 2) : ''}</td><td>${dot(sc.status)}${sc.exited ? ' exited' : ''}${sc.approx ? ' (approx)' : ''}</td>
      </tr>${open}`;
  }).join('');
  const cashRow = p.cashWeight ? `<tr><td><b>Cash</b></td><td class="num">${(p.cashWeight * 100).toFixed(1)}%</td><td class="num">${fmt.usd(p.cashWeight * 100000, { abbreviate: false, decimals: 0 })}</td><td></td><td class="num">0.0%</td><td></td><td></td></tr>` : '';
  const table = `<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>Holdings</h3><span class="card-note">click a row for its thesis</span></div>
      <div class="card-body" style="overflow-x:auto"><table class="data-table"><thead><tr><th>Holding</th><th class="num">Weight</th><th class="num">$</th><th class="num">Entry</th><th class="num">Return</th><th class="num">Contribution</th><th>Latest check-in</th></tr></thead>
      <tbody>${rows}${cashRow}</tbody></table></div></div>`;
  const log = p.researchLog || {};
  const research = `<div class="card"><div class="card-head"><h3>Research log</h3></div><div class="card-body">
      <h4>Themes considered</h4><ul>${(log.themes || []).map(th => `<li><b>${esc(th.name)}</b> — ${esc(th.summary)}</li>`).join('') || '<li>none recorded</li>'}</ul>
      <h4 style="margin-top:12px">Rejected candidates</h4><ul>${(log.rejected || []).map(r => `<li><b>${esc(r.ticker)}</b> — ${esc(r.reason)}</li>`).join('') || '<li>none recorded</li>'}</ul>
      ${p.snapshot?.notes ? `<h4 style="margin-top:12px">Market at creation</h4><p>${esc(p.snapshot.notes)}</p>` : ''}
    </div></div>`;
  return head + stats + chart + table + research;
}

// Two-line SVG chart: portfolio vs. S&P, both starting at $100,000.
function mountResearchChart() {
  const wrap = document.getElementById('researchChart'); if (!wrap) return;
  const s = AppState.research.scores[AppState.research.id]; const pts = s?.curve; if (!pts || pts.length < 2) return;
  const W = Math.max(280, wrap.clientWidth), H = wrap.clientHeight || 240, m = { t: 12, r: 16, b: 24, l: 64 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const t0 = new Date(pts[0][0]).getTime(), t1 = new Date(pts.at(-1)[0]).getTime();
  const all = pts.flatMap(p => [p[1], p[2]]); let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo || hi * 0.05) * 0.1; lo -= pad; hi += pad;
  const x = (d) => m.l + ((new Date(d).getTime() - t0) / (t1 - t0 || 1)) * iw, y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * ih;
  const line = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + f * (hi - lo));
  wrap.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Portfolio value versus S&P 500 total return">
    ${ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--ink-faint)">$${Math.round(v / 1000)}k</text>`).join('')}
    <path d="${line(2)}" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <path d="${line(1)}" fill="none" stroke="var(--brass)" stroke-width="2"/>
    <text x="${m.l}" y="${H - 6}" font-size="11" fill="var(--ink-faint)">${pts[0][0]}</text>
    <text x="${W - m.r}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--ink-faint)">${pts.at(-1)[0]} · <tspan fill="var(--brass)">portfolio</tspan> · dashed = S&amp;P</text>
  </svg>`;
}
```

- [ ] **Step 2: Build and test**

Run: `node tools/build.js && node tools/test.js`
Expected: build OK; all tests pass.

- [ ] **Step 3: Check in the browser with a real-ticker fixture**

Build a throwaway file in `$TMPDIR` from the Task 6 smoke draft, with an entry date in the past so there's a curve:
```bash
node -e "
const lib=require('./tools/research-lib');const {assemble}=require('./tools/build');
const p=require('./tools/fixtures/portfolio-fixture.json');
const real=['AAPL','MSFT','KO','JNJ','VOO','BND','TSM','XOM','WMT','NKE'];
p.positions.forEach((x,i)=>x.ticker=real[i]); p.id='UI-CHECK (test data)'; p.entryDate='2026-01-02';
p.checkIns=[{date:'2026-06-01',positions:[{ticker:'AAPL',status:'weakened',note:'test note'}],summary:'test'}];
p.fingerprint=lib.fingerprint(p);
require('fs').writeFileSync(process.env.TMPDIR+'/ledger-ui.html',assemble({research:[p]}));"
```
Open `file://$TMPDIR/ledger-ui.html`, click **Research**, and wait for scoring. Expected:
- The card shows an excess return.
- Opening it shows four stat cells, a two-line chart starting near $100k, and a holdings table with returns. (Entry prices are fixture values, but returns use adjusted closes from the entry date, so they're real.)
- Clicking `AAPL` expands the thesis with a "weakened" check-in.
- "Open AAPL in Ledger" runs a normal analysis.

Check at phone width with `resize_window` preset `mobile`: the table scrolls horizontally inside its card, with no page-level horizontal scroll. Reset with preset `desktop`.

- [ ] **Step 4: Commit**

```bash
git add src/06-render-research.js ledger.html
git commit -m "Add research portfolio detail view and comparison chart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Bottom-up screen (`tools/screen.js`)

**Files:**
- Create: `tools/screen.js`, `tools/universe/adrs.txt`, `tools/universe/bond-funds.txt`

**Interfaces:**
- Consumes: the app's `buildFundamentals`, `applyStockDefaults`, `computeValuation`, `impliedGrowth` via `vm` (the same loading as `tools/backtest.js`, including `05-data-and-flow.js` for `applyStockDefaults` and `Fetcher.convertForeign`).
- Produces: `research/screen-<YYYY-MM-DD>.json` (git-ignored via `research/`), an array of:
  ```
  { ticker, kind: 'stock'|'adr'|'bond-fund', name, price, verdict, passing, pe, pb, impliedGrowth, impliedWhy,
    epsCAGR5, revCAGR5, ret1y, offHigh, cyclical, qualityFlag, error }
  ```
  It also prints three lists: most undervalued (by `passing`, then lowest `impliedGrowth`), furthest off 52-week high, and lowest implied growth vs. 5-yr revenue CAGR.
- CLI: `LEDGER_CONTACT=you@example.com node tools/screen.js [--limit N]`

- [ ] **Step 1: Create the universe lists**

`tools/universe/adrs.txt` (one ticker per line; `#` comments allowed):
```
# International ADRs screened alongside the S&P 500. Per-share figures use ADR_RATIO in src/02-calculations.js.
TSM
ASML
NVO
SAP
TM
SONY
BABA
PDD
JD
BIDU
NTES
HDB
IBN
INFY
SHEL
BP
AZN
SNY
NVS
UL
DEO
UMC
ASX
```
`tools/universe/bond-funds.txt`:
```
# Bond funds screened on yield and trailing return (no SEC fundamentals).
BND
AGG
BNDX
TLT
IEF
SHY
LQD
HYG
TIP
VCIT
EMB
MUB
```

- [ ] **Step 2: Write `tools/screen.js`**

```js
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
  const tickers = [...body.matchAll(/<tr>\s*<td>\s*(?:<a[^>]*>)?([A-Z.]{1,6})(?:<\/a>)?\s*<\/td>/g)].map(m => m[1].replace('.', '-'));
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
            epsCAGR5: inp.epsCAGR5, revCAGR5: inp.revCAGR5, cyclical: !!inp.cyclical, qualityFlag: v.qualityFlag });
        }
      }
    } catch (e) { row.error = e.message; }
    out.push(row); process.stdout.write(row.error ? 'x' : '.');
    await sleep(200);
  }
  const file = path.join(ROOT, 'research', `screen-${today}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(out, null, 1));
  const pct = (x) => (app.ok(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');
  const show = (title, rows, f) => { console.log(`\n${title}`); rows.slice(0, 25).forEach(r => console.log(`  ${r.ticker.padEnd(6)} ${f(r)}`)); };
  const stocks = out.filter(r => !r.error && r.kind !== 'bond-fund');
  show('Most methods passing margin of safety:', [...stocks].sort((a, b) => (b.passing - a.passing) || ((a.impliedGrowth ?? 9) - (b.impliedGrowth ?? 9))), r => `${r.passing}/5 pass · implied growth ${pct(r.impliedGrowth)} · P/E ${r.pe?.toFixed?.(1) ?? 'n/a'} · ${r.verdict}`);
  show('Furthest below 52-week high:', [...out.filter(r => !r.error)].sort((a, b) => a.offHigh - b.offHigh), r => `${pct(r.offHigh)} off high · 1y ${pct(r.ret1y)} · ${r.kind}`);
  show('Implied growth furthest below 5-yr revenue growth:', stocks.filter(r => app.ok(r.impliedGrowth) && app.ok(r.revCAGR5)).sort((a, b) => (a.impliedGrowth - a.revCAGR5) - (b.impliedGrowth - b.revCAGR5)), r => `implied ${pct(r.impliedGrowth)} vs 5-yr revenue ${pct(r.revCAGR5)}${r.cyclical ? ' · cyclical' : ''}`);
  console.log(`\n${out.length} screened (${out.filter(r => r.error).length} errors). Saved ${path.relative(ROOT, file)}`);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run a small screen**

Run: `LEDGER_CONTACT=markbethers@gmail.com node tools/screen.js --limit 15`
Expected: 15 progress marks, three printed lists, and `Saved research/screen-<today>.json`. If the S&P list parse throws, fix the regex against the current Wikipedia HTML before continuing.

- [ ] **Step 4: Commit**

```bash
git add tools/screen.js tools/universe/adrs.txt tools/universe/bond-funds.txt
git commit -m "Add bottom-up screen for research portfolios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Research skill + README

**Files:**
- Create: `.claude/skills/ledger-research/SKILL.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: every CLI from Tasks 6 and 9; the draft format from Task 6; the check-in format from Task 6.

- [ ] **Step 1: Write the skill**

`.claude/skills/ledger-research/SKILL.md`:
````markdown
---
name: ledger-research
description: Run a Ledger research pass that produces a hypothetical $100k portfolio for a 1–5 year horizon, or check in on an existing research portfolio. Use when the user asks to research, build or check in on a Ledger research portfolio.
---

# Ledger research portfolios

Output is **hypothetical research, not investment advice.** Say so when presenting results. Never present a portfolio as a recommendation to the user.

Spec: `docs/superpowers/specs/2026-10-04-research-portfolios-design.md`. Data lives in `research/` (git-ignored, never commit it).

## New portfolio (one horizon per run)

Ask for the horizon (1–5 years) if not given. Then:

1. **Snapshot.** Record today's date, S&P 500 level, 10-yr Treasury, sector year-to-date performance and sentiment (search the web). This becomes `snapshot`.
2. **Candidates (about 40–60):**
   - *Trends:* identify 6–10 forces that matter over this horizon. 1 yr = near-term triggers (pricing, capacity dates, policy deadlines). 5 yr = structural shifts. For each, map first-, second- and third-order winners and losers. Favor bottlenecks (demand surging into inelastic supply) and businesses the market may be mis-classifying.
   - *Screen:* `LEDGER_CONTACT=<user email> node tools/screen.js`, then read `research/screen-<date>.json` for cheap, disliked and beaten-down names.
3. **Priced-in gate,** for every candidate:
   - Ledger valuation + implied growth (from the screen, or open the ticker in the app).
   - **Consensus,** with evidence (analyst estimates, sentiment, reaction to recent news).
   - **Variant view,** and why we'd know before the market.
   - **Catalyst** within the horizon.
   - **Kill criteria:** concrete and checkable.
   - Reject if there's no real disagreement with the market, or if implied growth already exceeds our view. Log every rejection with its reason in `researchLog.rejected`.
4. **Argue the other side.** For each survivor, write the strongest case that the market is right. Drop any that it defeats (log it in rejected).
5. **Construct.** 10–20 positions, each ≤ 15%, each `theme` ≤ 35% total, sectors ≤ 35% by judgment. Weight by conviction, reduced for risk. Bonds or cash only with a stated reason. Weights + `cashWeight` = 1.
6. **Present the draft to the user and wait for approval** before recording.
7. **Record.** Write the draft to `research/drafts/<YYYY-MM-DD>-<N>y.json` (all fields except `entryPrice`, `entryDate`, `benchmarkEntry`, `createdAt`, `checkIns`, `fingerprint`). Then run:
   ```bash
   node tools/record-portfolio.js research/drafts/<file>.json
   ```
   This fetches closing prices, validates, appends and builds the private copy (and the Drive copy if configured). Id format: `<YYYY-MM-DD>-<N>y-<letter>`.

## Check-in

1. `node tools/score-portfolios.js <id>` for current standing.
2. For each holding, test its `killCriteria` and thesis against the latest news. Status: `intact | weakened | broken`. Record `exitPrice` only for an acquisition or delisting.
3. Write `research/drafts/<id>-checkin-<date>.json` as `{ "date", "positions": [{ "ticker", "status", "note", "exitPrice"? }], "summary" }`, then run:
   ```bash
   node tools/add-checkin.js <id> research/drafts/<file>.json
   ```
4. Never edit positions. If changes are warranted, propose a **new** portfolio with `derivedFrom: <id>`, get the user's approval, then record it as above.
````

- [ ] **Step 2: Update `README.md`**

After the **Foreign companies.** paragraph, add:
```markdown
**What's priced in.** Each stock's Summary tab shows the growth rate today's price implies under Ledger's owner-earnings DCF (a reverse DCF), next to the company's 5-year revenue and EPS growth.

## Research portfolios

Hypothetical $100k portfolios for 1–5 year horizons, researched in Claude Code (`.claude/skills/ledger-research/`) and scored in the app's **Research** view against the S&P 500 total-return index. They are research, not investment advice. Each portfolio is frozen when created (an integrity fingerprint catches edits) and scored buy-and-hold. Check-ins add notes but never change holdings.

Research data is private: `research/` and `ledger.private.html` are git-ignored, and the public `ledger.html` always ships with none.

| Command | What it does |
|---|---|
| `node tools/build.js --private` | Builds `ledger.private.html` with your portfolios; copies it to `shareDir` from `research/config.json` if set (e.g. `{"shareDir": "~/Library/CloudStorage/GoogleDrive-<you>/My Drive/Ledger"}`) |
| `node tools/score-portfolios.js [id]` | Scores portfolios from the command line |
| `node tools/record-portfolio.js <draft>` | Freezes a researched draft at today's closing prices |
| `node tools/add-checkin.js <id> <checkin>` | Appends a check-in |
| `LEDGER_CONTACT=you@example.com node tools/screen.js` | Screens the S&P 500, ADRs and bond funds |

To share with someone: send them `ledger.private.html` (or the Drive copy). They download it and open it in a browser. Drive's preview won't run it.
```
In the **Making changes** section, after the `node tools/build.js` code block, add:
```markdown
Run the tests after any change to `src/` or `tools/`:

```bash
node tools/test.js
```
```

- [ ] **Step 3: Final verification**

Run: `node tools/build.js && node tools/test.js && LEDGER_CONTACT=markbethers@gmail.com node tools/check-extraction.js NKE AAPL KO`
Expected: build OK (public); all tests pass; extraction check matches its previous output (no regressions).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/ledger-research/SKILL.md README.md
git commit -m "Add ledger-research skill and document research portfolios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the plan

- **Drive setup (user):** create `research/config.json` with the real Google Drive path, then run `node tools/build.js --private` once to confirm the copy lands.
- **First research run** (build-order step 6) is a separate session: invoke the `ledger-research` skill with the chosen horizon.
