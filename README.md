# Ledger

A value-investing research tool that runs entirely in the browser. Type a stock, ETF, mutual fund, or bond-fund ticker and it pulls live data, then runs the Graham Number, Graham Revised, net-net, Lynch fair value, an owner-earnings DCF, and the Graham, Buffett, and Lynch checklists.

**To use it:** open `ledger.html` in any browser. No install, backend, or API key is required.

## Data sources

| Data | Source | How it's reached |
|---|---|---|
| Company financials | SEC EDGAR XBRL filings | via the free r.jina.ai reader relay (SEC blocks direct browser requests) |
| Prices, price history, distributions | Yahoo Finance | via the same relay |
| 10-year and 3-month Treasury yields | treasury.gov | direct |
| Fund expense ratio, assets, holdings *(optional)* | Alpha Vantage | direct, with the viewer's own free key |
| Backup price *(optional)* | Twelve Data | direct, with the viewer's own free key |

Optional keys are entered under **Data keys** in the app and stored only in that viewer's browser. Never write a key into the source files.

Anything that can't be fetched is shown as **Unavailable** with the reason. Missing data is never filled with 0.

**Earnings quality.** If 25% or more of pre-tax income is non-operating (investment gains, asset sales), or net income is more than double operating cash flow, the Summary tab shows a warning, lowers the confidence score, and offers a one-click switch to value the stock on estimated core earnings instead.

**Foreign companies.** Filers that report under IFRS or in another currency (e.g. TSMC in Taiwan dollars) are read and converted to US dollars at the live exchange rate, with per-share figures scaled to the US-listed ADR using a built-in ratio list (`ADR_RATIO` in `src/02-calculations.js`).

**What's priced in.** Each stock's Summary tab shows the growth rate today's price implies under Ledger's owner-earnings DCF (a reverse DCF), next to the company's 5-year revenue and EPS growth.

## Research portfolios

Hypothetical $100k portfolios for 1–5 year horizons, researched in Claude Code (`.claude/skills/ledger-research/`) and scored in the app's **Research** view against the S&P 500 total-return index. They are research, not investment advice. Each portfolio is frozen when created (an integrity fingerprint catches edits) and scored buy-and-hold. Check-ins add notes but never change holdings.

Each portfolio can also carry an **avoid list**: names the research expects to do worse than the market prices. The tool is long-only, so these aren't shorted; they're scored against the S&P so negative calls build a track record too. The screen reports **shareholder yield** (dividends + net buybacks ÷ market cap), read from SEC filings.

Research data is private: `research/` and `ledger.private.html` are git-ignored, and the public `ledger.html` always ships with none.

| Command | What it does |
|---|---|
| `node tools/build.js --private` | Builds `ledger.private.html` with your portfolios; copies it to `shareDir` from `research/config.json` if set (e.g. `{"shareDir": "~/Library/CloudStorage/GoogleDrive-<you>/My Drive/Ledger"}`) |
| `node tools/score-portfolios.js [id]` | Scores portfolios from the command line |
| `node tools/record-portfolio.js <draft>` | Freezes a researched draft at today's closing prices |
| `node tools/add-checkin.js <id> <checkin>` | Appends a check-in |
| `LEDGER_CONTACT=you@example.com node tools/screen.js` | Screens the S&P 500, ADRs and bond funds |

To share with someone: send them `ledger.private.html` (or the Drive copy). They download it and open it in a browser. Drive's preview won't run it.

## Making changes

The app is still delivered as one file, but it's edited as parts in `src/` and assembled by a build script:

| Part | What's in it |
|---|---|
| `01-head.html` | Page structure and all styles |
| `02-calculations.js` | Settings, reference data, formatting helpers, and every valuation/checklist formula |
| `03-xbrl.js` | Reading SEC XBRL data by reporting period, TTM, stock-split detection, CAGR |
| `04-fundamentals.js` | Turning SEC filings into the app's input fields, with a reason for every gap |
| `05-data-and-flow.js` | Network calls, optional keys, price statistics, and the Analyze flow |
| `06-render.js` | Every tab, the price chart, and the financials table |
| `07-events.js` | Buttons, keyboard handling, editing, startup |
| `08-tail.html` | Closing tags |

After editing anything in `src/`:

```bash
node tools/build.js
```

Run the tests after any change to `src/` or `tools/`:

```bash
node tools/test.js
```

This rebuilds `ledger.html` and stops with an error if the script has a syntax problem. Commit the `src/` change and the rebuilt `ledger.html` together.

To check the SEC data extraction against live filings after changing `03-xbrl.js` or `04-fundamentals.js`:

```bash
LEDGER_CONTACT=you@example.com node tools/check-extraction.js NKE AAPL KO PLPC BRK-B
```

## Known limits

- **AAA corporate bond yield** isn't published anywhere free that a browser can read, so it's a dated default you should update.
- **Bond-fund yield-to-maturity and duration** come only from the fund's fact sheet, so you enter them yourself.
- **Some foreign filers' newest annual reports aren't in SEC's machine-readable data** (TSMC's runs through FY2024 as of Oct 2026); the app flags figures over a year old.
- **ADRs not in the built-in ratio list** are assumed to be 1 ADR = 1 share, with a warning.
- **Companies that don't use standard XBRL tags** (Berkshire Hathaway, for example) show EPS and some other fields as unavailable, with the reason.
- **SEC's machine-readable history starts around 2009**, so Graham's 20-year dividend test can show as UNVERIFIED rather than PASS.
- **The r.jina.ai relay is a free third-party service.** It can see which tickers are looked up, and it limits how many requests you can make in a short period. If it goes down, SEC and Yahoo data become unavailable and the app says so.

Educational decision-support only, not investment advice.
