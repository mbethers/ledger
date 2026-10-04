# Research Portfolios — Design

**Date:** 2026-10-04
**Status:** Approved in conversation; awaiting spec review

## Purpose

Let the user pick a horizon of 1–5 years and get a hypothetical $100k portfolio built from deep research, aimed at outperforming the S&P 500 over that horizon, then track honestly whether it did.

The output is labeled **hypothetical research, not investment advice** everywhere it appears.

### What drove the design

- **Findable ≠ profitable.** Insights the market already knows are priced in. The Oct 2025 backtests showed the big winners came from bottlenecks the market mis-classified, while the obvious AI name barely beat the index. So every holding must state a specific disagreement with what the price implies.
- **It cannot be backtested.** Any AI model doing the research knows what happened before its training cutoff, so historical tests are contaminated. The only honest test is going forward: freeze each portfolio at creation and score it as time passes.

## Decisions

| Topic | Decision |
|---|---|
| Where research runs | Phase 1: in Claude Code, via a project skill that writes a data file the app reads. Later (out of scope here): in-app with the user's Anthropic API key, reusing the same procedure as the prompt. |
| What it can hold | US-listed stocks and ETFs, international ADRs, bond funds. Long only. Cash allowed. |
| Benchmark | S&P 500 total-return index (`^SP500TR`). |
| Success measure | Total return vs. benchmark, reported with max drawdown and volatility for both. |
| Horizon | Buy-and-hold for the chosen horizon. Check-ins review theses but never edit a portfolio; changes become a new, linked portfolio. |
| Size | 10–20 positions, max 15% each, max 35% in any one theme or sector. |
| Research method | Hybrid: trends (top-down) and a screen (bottom-up) both feed candidates; every candidate must pass a "priced-in" gate. |
| Privacy | Research data is never committed (the repo and its GitHub Pages site are public). A private local build includes it; the public build excludes it. The private build is also copied to a Google Drive folder for sharing with select people. |

## 1. Data

### File

`research/portfolios.json` — git-ignored. Holds an array of portfolios, appended to over time.

### Portfolio record

```json
{
  "id": "2026-10-05-3y-a",
  "createdAt": "2026-10-05T21:10:00Z",
  "horizonYears": 3,
  "derivedFrom": null,
  "benchmark": "^SP500TR",
  "entryDate": "2026-10-05",
  "benchmarkEntry": 15234.56,
  "snapshot": { "sp500": 6890.1, "treasury10y": 0.0412, "notes": "market context at creation" },
  "positions": [
    {
      "ticker": "XYZ",
      "type": "stock | etf | adr | bond-fund",
      "weight": 0.08,
      "entryPrice": 41.27,
      "thesis": {
        "pricedIn": "Price implies 4%/yr growth for 10 yrs (reverse DCF).",
        "consensus": "What the market believes, with evidence.",
        "variant": "What we believe differently, and why we would know first.",
        "catalyst": "What should make the market see it within the horizon.",
        "killCriteria": "Concrete, checkable condition that proves the thesis wrong."
      },
      "theme": "power-bottleneck",
      "sources": ["https://..."]
    }
  ],
  "cashWeight": 0.0,
  "researchLog": {
    "themes": [{ "name": "...", "summary": "..." }],
    "rejected": [{ "ticker": "...", "reason": "..." }]
  },
  "checkIns": [
    {
      "date": "2027-01-10",
      "positions": [{ "ticker": "XYZ", "status": "intact | weakened | broken", "note": "...", "exitPrice": null }],
      "summary": "..."
    }
  ],
  "fingerprint": "sha256 of id, entryDate, benchmarkEntry, positions[ticker,type,weight,entryPrice], cashWeight"
}
```

### Integrity rules

- Positions, weights, entry prices and `benchmarkEntry` are never edited after creation. The **fingerprint** is computed at creation; validation fails if it no longer matches. Git can't enforce this because the file isn't committed.
- `checkIns` is append-only.
- Entry prices are the actual closing prices on `entryDate`, fetched when the portfolio is recorded.
- An acquired or delisted holding is closed by a check-in entry with `exitPrice`. From then on the holding's value is held as cash.

## 2. Research procedure (project skill)

Saved as `.claude/skills/ledger-research/SKILL.md`. One run produces one portfolio for one horizon.

1. **Snapshot.** Date, horizon, S&P level, 10-yr Treasury, sector year-to-date performance, sentiment.
2. **Candidates (about 40–60).**
   - *Trends:* 6–10 forces that matter over the horizon. For 1 year, near-term triggers (pricing, capacity dates, policy deadlines). For 5 years, structural shifts. Map first-, second- and third-order winners and losers, focusing on bottlenecks and businesses the market may be mis-classifying.
   - *Screen:* `tools/screen.js` runs Ledger's valuation engine over the S&P 500 plus curated lists of ADRs and bond funds. Pulls the cheap, disliked and beaten-down names.
3. **Priced-in gate.** For each candidate:
   - Ledger valuation plus **implied growth** (reverse DCF).
   - Consensus, with evidence: analyst estimates, sentiment, reaction to recent news.
   - Variant view, and why we would know first.
   - Catalyst within the horizon.
   - Kill criteria.

   **Reject** if there is no real disagreement with the market, or if implied growth already exceeds our view. Every rejection is logged with its reason.
4. **Argue the other side.** For each survivor, make the strongest case that the market is right. Drop any survivor that case defeats.
5. **Build the portfolio.** 10–20 positions, ≤15% each, ≤35% per theme or sector. Weight by conviction, reduced for risk. Bonds or cash only with a stated reason.
6. **Record.** Fetch closing prices on the entry date, write the record with its fingerprint, run validation, rebuild, copy to Drive.

**Check-in procedure** (same skill). For each holding, test the kill criteria and thesis against the latest news. Mark it intact, weakened or broken, and append the check-in. If changes are warranted, propose a new portfolio with `derivedFrom` set. The user approves it before it is recorded.

## 3. App

### Research view

A **Research** button in the header opens a separate view. A banner on every research screen reads: *"Hypothetical research portfolios — not investment advice."*

- **List.**
  - One card per portfolio: created date, horizon and progress (e.g. "3-yr · month 4 of 36"), return vs. S&P to date, and status (active, matured, or derived from …).
  - A horizon filter.
  - A scoreboard across all portfolios: how many beat the S&P and by how much.
- **Detail.**
  - Headline figures: portfolio return, S&P return, the difference, max drawdown and volatility for both, annualized once older than a year.
  - Chart: $100k in the portfolio vs. $100k in the S&P since entry.
  - Holdings table: ticker, type, weight, dollars, entry → current price, return, contribution, and the latest check-in status.
  - Clicking a row expands its thesis, sources and check-in history, plus an "Open in Ledger" link.
  - Research log at the bottom.

### Scoring rules

- **Buy and hold:** weights drift with prices.
- **Dividends** are included via Yahoo's adjusted close. The benchmark uses `^SP500TR`.
- **Cash** earns 0%.
- **When the horizon ends,** the score freezes at that date.
- **Missing prices:** a holding whose price can't be fetched shows "Unavailable", and the total is marked incomplete. Never filled with 0.
- **ADRs** are scored in US dollars as listed.

### "What's priced in" panel (every stock's Summary tab)

Solve for the growth rate that makes Ledger's owner-earnings DCF equal the current price, holding the discount rate and terminal growth at their current inputs. Use bisection over a sensible range.

Show the result next to the 5-yr revenue CAGR, the 5-yr EPS CAGR and the expected-growth input, e.g. *"Today's price assumes 18%/yr growth for 10 years; the last 5 years averaged 9%."*

When there's no solution (owner earnings ≤ 0, or the price is above any value in the range), say why instead of showing a number.

## 4. Build and sharing

- `tools/build.js` gains a private mode.
  - **Public build** (default, committed): the research data is an empty array. The build fails if any research data would be included.
  - **Private build:** writes `ledger.private.html` (git-ignored) with the research inlined.
  - **Drive copy:** if `research/config.json` (git-ignored) sets `shareDir` (e.g. `~/Library/CloudStorage/GoogleDrive-…/My Drive/Ledger`), the private build is copied there as `ledger.html`.
- **For recipients:** download and open the file. Drive's preview won't run it. Their API keys, if any, stay in their own browser. The file is a snapshot of the research at build time, so the Drive copy is refreshed on each private build.

## 5. Testing

`tools/test.js` loads `src/` the way the backtest tools do and checks results with plain Node, with no new dependencies. Tests are written before each piece.

- **Reverse DCF:** round-trip (value at a known g, solve back to g); no-solution cases return a reason.
- **Scoring, on synthetic price series:** known return, drawdown and volatility; weight drift; 0% cash; missing price → incomplete; freeze at horizon end; exit-to-cash after a delisting.
- **Validation:** position count, weight cap, position weights plus `cashWeight` summing to 1 (±0.001), the 35% cap per `theme` value, all five thesis fields present, fingerprint match. (The sector cap is applied during research. Only `theme` is machine-checked.)
- **Build:** the public output contains no research; the private output and the Drive copy do.
- **UI:** checked in the browser pane against a fixture portfolio clearly marked as a test file. The existing `tools/check-extraction.js` is re-run to confirm nothing else regressed.

## 6. Build order

Each step is usable and committed on its own.

1. "What's priced in" panel (reverse DCF).
2. Portfolio format, validation and scoring; `tools/score-portfolios.js`.
3. Build changes: private and public builds, Drive copy.
4. Research view in the app.
5. `tools/screen.js` and the research skill (research and check-in procedures).
6. First real research run, as its own session, with the horizon chosen by the user.

## Out of scope

In-app research (option A), short selling, options, scheduled rebalancing, multi-currency scoring, and interest on cash.
