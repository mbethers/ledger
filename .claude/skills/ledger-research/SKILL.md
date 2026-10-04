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
   - *Screen:* `LEDGER_CONTACT=<user email> node tools/screen.js`, then read `research/screen-<date>.json` for cheap, disliked and beaten-down names. Rows marked stale (fundamentals > 15 months old, common for foreign filers) need manual valuation from current reports.
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
