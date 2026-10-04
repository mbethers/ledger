
/* ============================================================================
   PART 4b — NETWORK + LIVE DATA
   Why a relay: SEC EDGAR (www.sec.gov, data.sec.gov/api/xbrl) and Yahoo Finance send
   no CORS headers, so a browser page cannot read them directly — the original build's
   fetches to SEC and Stooq were being blocked outright (and Stooq now serves a JavaScript
   bot-challenge page instead of CSV). r.jina.ai is a free, keyless reader relay that adds
   CORS headers; "X-Return-Format: text" makes it return the upstream body verbatim.
   Treasury yields come straight from treasury.gov, which does allow CORS.
   ============================================================================ */

const Net = {
  RELAY: 'https://r.jina.ai/',
  async get(url, { relay = false, timeoutMs = 45000, retries = 2 } = {}) {
    const target = relay ? this.RELAY + url : url;
    const headers = relay ? { 'X-Return-Format': 'text' } : {};
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetch(target, { headers, signal: ctl.signal });
        const body = await res.text();
        if (res.ok) return body;
        let detail = ''; try { detail = JSON.parse(body).message || ''; } catch (e) { /* not JSON */ }
        lastErr = new Error(`HTTP ${res.status}${res.status === 429 ? ' — rate-limited by the free relay; wait ~1 minute and retry' : ''}${detail ? ` (${detail.slice(0, 140)})` : ''}`);
        if (!(res.status === 429 || res.status >= 500)) break; // 4xx other than 429 won't fix itself
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error(`timed out after ${timeoutMs / 1000}s`)
          : new Error(relay ? 'network error reaching the r.jina.ai relay (offline, or blocked by an ad/privacy blocker?)' : 'request blocked by the browser (CORS) or network error');
      } finally { clearTimeout(timer); }
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
    throw lastErr;
  },
  async json(url, opts) {
    const text = await this.get(url, opts);
    try { return JSON.parse(text); } catch (e) { /* the relay may prepend a header block */ }
    const i = text.indexOf('{');
    if (i >= 0) { try { return JSON.parse(text.slice(i)); } catch (e) { /* fall through */ } }
    throw new Error(`unexpected non-JSON response (${text.slice(0, 80).replace(/\s+/g, ' ')}…)`);
  },
};

/* ---- Optional user-supplied API keys (never hard-coded; stored only in this browser) ---- */
const Keys = {
  _k: { av: '', td: '' },
  async load() { const s = await Store.get('api_keys'); if (s) this._k = { av: s.av || '', td: s.td || '' }; },
  get(name) { return this._k[name] || ''; },
  async set(av, td) { this._k = { av: (av || '').trim(), td: (td || '').trim() }; await Store.set('api_keys', this._k); },
};
const num = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : null; };

// Alpha Vantage: direct (it sends CORS headers), paced, and cached for a day because the free
// tier allows only a small number of requests per day. Errors never echo the key.
const AV = {
  last: 0, GAP: 1300,
  async call(fn, params, ttlMs = 24 * 3600 * 1000) {
    const key = Keys.get('av'); if (!key) return null;
    const ck = `av_v1:${fn}:${JSON.stringify(params)}`;
    const cached = await Store.get(ck);
    if (cached && Date.now() - cached.at < ttlMs) return cached.data;
    const wait = this.GAP - (Date.now() - this.last); if (wait > 0) await sleep(wait);
    this.last = Date.now();
    const qs = new URLSearchParams({ function: fn, ...params, apikey: key });
    const j = await Net.json(`https://www.alphavantage.co/query?${qs}`, { retries: 0, timeoutMs: 20000 });
    if (j['Error Message']) throw new Error('symbol not covered by Alpha Vantage');
    const info = j.Note || j.Information;
    if (info) throw new Error(/rate|limit|frequency|per day|premium/i.test(info) ? 'daily/minute request limit reached on your free key — try again later' : /invalid|api key/i.test(info) ? 'the saved key was rejected — check it under Data keys' : info.slice(0, 140));
    if (!j || !Object.keys(j).length) throw new Error('no data returned for this symbol');
    await Store.set(ck, { at: Date.now(), data: j });
    return j;
  },
};

// Twelve Data: backup price only (used when the main price source fails).
async function twelveDataQuote(ticker) {
  const key = Keys.get('td'); if (!key) return null;
  const qs = new URLSearchParams({ symbol: ticker.replace(/-/g, '.'), apikey: key });
  const j = await Net.json(`https://api.twelvedata.com/quote?${qs}`, { retries: 0, timeoutMs: 15000 });
  if (j.status === 'error' || j.code >= 400) throw new Error(/api ?key/i.test(j.message || '') ? 'the saved key was rejected — check it under Data keys' : (j.message || 'error').slice(0, 140));
  const price = num(j.close);
  if (!ok(price)) throw new Error('no price in response');
  return { price, asOf: j.datetime || null, currency: j.currency, type: null, name: j.name || null, rows: [], dividends: [], source: 'Twelve Data (backup price; no history)' };
}

const Fetcher = {
  log: [],
  note(level, text) { this.log.push({ level, text }); renderFetchStatus(); },
  reset() { this.log = []; },

  async getTickerMap() {
    const cached = await Store.get('sec_ticker_map_v2');
    if (cached && (Date.now() - cached.fetchedAt) < 7 * 24 * 3600 * 1000) return cached.map;
    const data = await Net.json('https://www.sec.gov/files/company_tickers.json', { relay: true });
    const map = {};
    Object.values(data).forEach(row => { map[String(row.ticker).toUpperCase()] = [String(row.cik_str).padStart(10, '0'), row.title]; });
    if (Object.keys(map).length < 1000) throw new Error('SEC ticker list came back truncated');
    await Store.set('sec_ticker_map_v2', { map, fetchedAt: Date.now() });
    return map;
  },

  async fetchCompanyFacts(ticker) {
    let map;
    try { map = await this.getTickerMap(); }
    catch (e) { this.note('err', `Couldn't load SEC's ticker→CIK list (${e.message}). Fundamentals unavailable.`); return null; }
    const hit = map[ticker] || map[ticker.replace(/-/g, '')] || map[ticker.replace(/-/g, '.')];
    if (!hit) { this.note('warn', `${ticker} isn't in SEC's list of operating-company tickers (ETFs, funds, and most foreign listings aren't). Fundamentals unavailable.`); return null; }
    const [cik, title] = hit;
    this.note('ok', `SEC EDGAR: ${ticker} → CIK ${cik} (${title}).`);
    // Sector from the submissions endpoint (this one does allow CORS) — optional, never blocks.
    const subs = Net.json(`https://data.sec.gov/submissions/CIK${cik}.json`, { retries: 0, timeoutMs: 15000 }).catch(() => null);
    let facts;
    try { facts = await Net.json(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { relay: true, timeoutMs: 60000 }); }
    catch (e) { this.note('err', `SEC EDGAR financial statements request failed: ${e.message}`); return null; }
    if (!facts?.facts?.['us-gaap']) { this.note('err', `SEC returned no us-gaap financial data for ${ticker} (IFRS filers and some trusts don't use it).`); return null; }
    const s = await subs;
    return { facts, cik, title, sector: s?.sicDescription || null };
  },

  async fetchStockFundamentals(ticker) {
    const bundle = await this.fetchCompanyFacts(ticker);
    if (!bundle) return { values: {}, source: {}, why: {}, warnings: [], failed: true };
    const r = buildFundamentals(bundle.facts);
    r.values.companyName = bundle.title; r.source.companyName = `SEC EDGAR · CIK ${bundle.cik}`;
    if (bundle.sector) { r.values.sector = bundle.sector; r.source.sector = 'SEC EDGAR · SIC description'; }
    const core = ['revenue', 'netIncome', 'epsTTM', 'totalEquity', 'dilutedShares', 'totalCurrentAssets', 'totalLiabilities', 'operatingCashFlow', 'capex', 'da', 'ebit'];
    const missing = core.filter(f => r.values[f] == null);
    this.note(missing.length ? 'warn' : 'ok', `SEC EDGAR fundamentals through ${r.values.periodEnd || '?'} (balance sheet ${r.values.balanceSheetDate || '?'}): ${core.length - missing.length}/${core.length} core fields${missing.length ? ` — missing ${missing.map(f => FIELD_LABEL[f]).join(', ')}` : ''}.`);
    r.warnings.forEach(w => this.note(/^Detected a/.test(w) ? 'info' : 'warn', w));
    return r;
  },

  // Yahoo chart API: price, instrument type, name, 10y daily closes (raw + dividend-adjusted) and distributions.
  async fetchQuote(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d&events=div`;
    let data;
    try { data = await Net.json(url, { relay: true }); }
    catch (e) { this.note('err', `Price lookup failed for ${ticker}: ${e.message}`); return null; }
    const res = data?.chart?.result?.[0];
    if (!res) { this.note('err', `Yahoo Finance has no quote for "${ticker}" (${data?.chart?.error?.description || 'unknown symbol'}). Check the ticker.`); return null; }
    const m = res.meta || {}, ts = res.timestamp || [], q = res.indicators?.quote?.[0] || {}, adj = res.indicators?.adjclose?.[0]?.adjclose || [];
    const rows = [];
    ts.forEach((t, i) => { const c = q.close?.[i]; if (ok(c)) rows.push({ date: new Date(t * 1000).toISOString().slice(0, 10), close: c, adj: ok(adj[i]) ? adj[i] : c }); });
    const dividends = Object.values(res.events?.dividends || {}).map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount })).sort((a, b) => (a.date < b.date ? -1 : 1));
    const price = ok(m.regularMarketPrice) ? m.regularMarketPrice : rows.length ? rows[rows.length - 1].close : null;
    const asOf = m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString().slice(0, 10) : rows.length ? rows[rows.length - 1].date : null;
    if (!ok(price)) { this.note('err', `Yahoo returned no usable price for ${ticker}.`); return null; }
    this.note('ok', `Price ${fmt.plain(price)} ${m.currency || ''} as of ${asOf} (${m.instrumentType || 'unknown type'}${m.longName ? ` · ${m.longName}` : ''}); ${rows.length.toLocaleString()} days of history.`);
    if (m.currency && m.currency !== 'USD') this.note('warn', `${ticker} is quoted in ${m.currency}, but SEC figures are in USD — per-share ratios will be wrong unless you convert.`);
    return { price, asOf, currency: m.currency, type: m.instrumentType, name: m.longName || m.shortName || null, rows, dividends, source: 'Yahoo Finance (via relay)' };
  },

  // Main price path, with Twelve Data as a backup when the user has saved a key.
  async fetchQuoteWithBackup(ticker) {
    const q = await this.fetchQuote(ticker);
    if (q || !Keys.get('td')) return q;
    try {
      const t = await twelveDataQuote(ticker);
      this.note('ok', `Backup price from Twelve Data: ${fmt.plain(t.price)} ${t.currency || ''} as of ${t.asOf}. No price history from this source, so returns and volatility stay unavailable.`);
      return t;
    } catch (e) { this.note('err', `Twelve Data backup price also failed: ${e.message}`); return null; }
  },

  async fetchTreasury() {
    const cached = await Store.get('treasury_v2');
    if (cached && Date.now() - cached.fetchedAt < 12 * 3600 * 1000) return cached.data;
    const yr = new Date().getFullYear();
    for (const y of [yr, yr - 1]) {
      try {
        const csv = await Net.get(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}`, { retries: 1, timeoutMs: 20000 });
        const rows = parseCSV(csv).filter(r => r.Date && ok(parseFloat(r['10 Yr'])));
        if (!rows.length) continue;
        const toISO = (d) => { const [mm, dd, yy] = d.split('/'); return `${yy}-${mm}-${dd}`; };
        rows.sort((a, b) => (toISO(a.Date) < toISO(b.Date) ? 1 : -1));
        const r = rows[0];
        const data = { asOf: toISO(r.Date), y10: parseFloat(r['10 Yr']) / 100, m3: ok(parseFloat(r['3 Mo'])) ? parseFloat(r['3 Mo']) / 100 : null };
        await Store.set('treasury_v2', { data, fetchedAt: Date.now() });
        return data;
      } catch (e) { /* try previous year, then give up */ }
    }
    return null;
  },
};

// ---- price-history statistics (dividend-adjusted closes = total return) ----
function rowNear(rows, isoTarget, tolDays = 10) {
  let best = null, bestDiff = Infinity;
  for (const r of rows) { const d = Math.abs(dDays(r.date, isoTarget)); if (d < bestDiff) { bestDiff = d; best = r; } }
  return best && bestDiff <= tolDays ? best : null;
}
function trailingReturn(rows, years) {
  if (!rows || rows.length < 2) return { val: null, why: 'no price history' };
  const last = rows[rows.length - 1];
  const target = new Date(new Date(last.date).getTime() - years * 365.25 * DAY).toISOString().slice(0, 10);
  const start = rowNear(rows, target);
  if (!start) return { val: null, why: `price history only starts ${rows[0].date} — less than ${years} year${years > 1 ? 's' : ''}` };
  const total = last.adj / start.adj;
  return { val: years > 1 ? Math.pow(total, 1 / years) - 1 : total - 1 };
}
function riskStats(rows, riskFree, years = 5) {
  if (!rows || rows.length < 60) return { why: 'not enough price history' };
  const last = rows[rows.length - 1];
  const cutoff = new Date(new Date(last.date).getTime() - years * 365.25 * DAY).toISOString().slice(0, 10);
  const win = rows.filter(r => r.date >= cutoff);
  const rets = []; for (let i = 1; i < win.length; i++) rets.push(win[i].adj / win[i - 1].adj - 1);
  const annVol = sampleStdev(rets) * Math.sqrt(252);
  const yrs = dDays(last.date, win[0].date) / 365.25;
  const annRet = Math.pow(last.adj / win[0].adj, 1 / yrs) - 1;
  let peak = win[0].adj, maxDD = 0; for (const r of win) { peak = Math.max(peak, r.adj); maxDD = Math.min(maxDD, r.adj / peak - 1); }
  return { stdDev: annVol, sharpe: annVol > 0 && ok(riskFree) ? (annRet - riskFree) / annVol : null, maxDrawdown: maxDD, window: `${win[0].date} → ${last.date}` };
}
function ttmDistributionYield(dividends, price, asOf) {
  if (!ok(price) || price <= 0) return null;
  const cutoff = new Date(new Date(asOf).getTime() - 365 * DAY).toISOString().slice(0, 10);
  const sum = dividends.filter(d => d.date > cutoff).reduce((s, d) => s + d.amount, 0);
  return sum / price;
}

/* ============================================================================
   PART 5 — STATE, DEFAULTS, ANALYZE FLOW
   ============================================================================ */

const AppState = {
  selectedType: 'stock',  // the toggle in the header — what the NEXT analysis should be
  assetType: 'stock',     // what the CURRENT report is (FIX: these were one variable, so
                          // flipping the toggle after an analysis crashed the next re-render)
  ticker: '', activeTab: 'summary', runId: 0, busy: false,
  stock: null, fund: null, bond: null, portfolio: null, lynch: null,
  fieldSource: {}, sourceDetail: {}, warnings: [], analyzedAt: null, watchlist: [],
  priceHistory: null, priceHistoryWhy: null, chartRange: '5Y',
};

// Daily closes for the last year + weekly before that (~700 points): enough for the chart,
// small enough to save with each profile in browser storage.
function compactHistory(rows) {
  if (!rows || rows.length < 2) return null;
  const last = rows[rows.length - 1].date;
  const cutoff = new Date(new Date(last).getTime() - 366 * DAY).toISOString().slice(0, 10);
  const out = []; let lastWeek = null;
  for (const r of rows) {
    if (r.date >= cutoff) { out.push([r.date, +r.close.toFixed(4)]); continue; }
    const wk = Math.floor(new Date(r.date).getTime() / (7 * DAY));
    if (wk !== lastWeek) { out.push([r.date, +r.close.toFixed(4)]); lastWeek = wk; }
  }
  return out;
}

const STOCK_FETCHED_FIELDS = ['companyName', 'sector', 'revenue', 'grossProfit', 'ebit', 'netIncome', 'da', 'interestExpense', 'epsTTM', 'dividendsPaid',
  'cash', 'shortTermInvestments', 'totalCurrentAssets', 'totalAssets', 'totalCurrentLiabilities', 'longTermDebt', 'totalDebt', 'totalLiabilities',
  'goodwill', 'intangibles', 'totalEquity', 'operatingCashFlow', 'capex', 'sbc', 'dilutedShares', 'revCAGR5', 'epsCAGR5', 'epsCAGR10', 'fcfCAGR5',
  'avgROE', 'avgROIC', 'debtEquity', 'grossMarginStdDev', 'yearsPositiveEarnings', 'yearsDividends'];

// Shown for reference but not used by any calculation, so a gap here isn't flagged as a data problem.
const INFO_ONLY_FIELDS = new Set(['sbc', 'companyName']);

function applyStockDefaults(fetched, quote, tsy, ticker, ov) {
  const inp = { ...fetched.values }; const src = {}; const detail = { ...fetched.source }; const why = { ...fetched.why };
  inp.ticker = ticker;
  for (const f of STOCK_FETCHED_FIELDS) {
    if (inp[f] != null) src[f] = 'fetched';
    else { inp[f] = null; src[f] = INFO_ONLY_FIELDS.has(f) ? 'manual' : 'missing'; if (!why[f]) why[f] = fetched.failed ? 'SEC EDGAR fundamentals unavailable for this ticker' : 'not returned by SEC EDGAR'; }
  }
  if (!inp.companyName && quote?.name) { inp.companyName = quote.name; src.companyName = 'fetched'; detail.companyName = 'Yahoo Finance'; }
  if (inp.sector == null) { inp.sector = ''; src.sector = 'manual'; delete why.sector; }
  if (quote) { inp.price = quote.price; inp.priceAsOf = quote.asOf; src.price = 'fetched'; detail.price = `${quote.source} · as of ${quote.asOf}`; }
  else { inp.price = null; src.price = 'missing'; why.price = 'price lookup failed — see the fetch log at the top'; }

  // Alpha Vantage (optional key): fill per-share gaps SEC couldn't, never overriding SEC values.
  if (ov) {
    const avEps = num(ov.DilutedEPSTTM), avShares = num(ov.SharesOutstanding), asOf = ov.LatestQuarter ? ` · quarter ending ${ov.LatestQuarter}` : '';
    if (!ok(inp.epsTTM) && ok(avEps)) { inp.epsTTM = avEps; src.epsTTM = 'fetched'; detail.epsTTM = `Alpha Vantage OVERVIEW (DilutedEPSTTM)${asOf} — SEC XBRL had none (${why.epsTTM})`; delete why.epsTTM; inp.epsBasis = 'TTM, Alpha Vantage'; }
    if (!ok(inp.dilutedShares) && ok(avShares)) { inp.dilutedShares = avShares; src.dilutedShares = 'fetched'; detail.dilutedShares = `Alpha Vantage OVERVIEW (SharesOutstanding) — SEC XBRL had none`; delete why.dilutedShares; }
    if (ov.Industry && !inp.industry) inp.industry = ov.Industry;
  }

  // ---- neutral defaults (README) — assumptions, clearly marked as such ----
  ['moat', 'management', 'simplicity', 'stability', 'accountingQuality'].forEach(f => { inp[f] = DEFAULTS.qualitative; src[f] = 'default'; detail[f] = 'Neutral default (3 of 5) — score it yourself'; });
  if (ok(inp.epsCAGR5)) { inp.expectedGrowth = Math.min(inp.epsCAGR5, DEFAULTS.growthCapIfHistory); detail.expectedGrowth = `Seeded from 5yr EPS CAGR (${fmt.plain(inp.epsCAGR5 * 100, 1)}%), capped at ${DEFAULTS.growthCapIfHistory * 100}%`; }
  else { inp.expectedGrowth = DEFAULTS.growthIfNoHistory; detail.expectedGrowth = `Placeholder ${DEFAULTS.growthIfNoHistory * 100}% — 5yr EPS CAGR unavailable (${why.epsCAGR5 || 'no data'})`; }
  src.expectedGrowth = 'default';
  inp.terminalGrowth = DEFAULTS.terminalGrowth; src.terminalGrowth = 'default'; detail.terminalGrowth = 'Workbook default';
  if (tsy) { inp.treasury10y = tsy.y10; src.treasury10y = 'fetched'; detail.treasury10y = `US Treasury daily par yield curve · 10 Yr · ${tsy.asOf}`; }
  else { inp.treasury10y = DEFAULTS.treasury10yDefault; src.treasury10y = 'default'; detail.treasury10y = DEFAULTS.treasury10yAsOf; }
  inp.discountRate = Math.max(DEFAULTS.discountFloor, inp.treasury10y + DEFAULTS.discountTreasurySpread); src.discountRate = 'default'; detail.discountRate = 'max(10%, 10yr Treasury + 5%)';
  inp.aaaYield = DEFAULTS.aaaYieldDefault; src.aaaYield = 'default'; detail.aaaYield = DEFAULTS.aaaYieldAsOf;
  inp.requiredMOS = DEFAULTS.requiredMOS; src.requiredMOS = 'default'; detail.requiredMOS = 'Workbook default';
  inp.__why = why;
  return { inp, src, detail };
}

function applyFundDefaults(quote, tsy, bench, ticker, profile, profileErr) {
  const ref = ETF_REFERENCE[ticker];
  const inp = { ticker }; const src = {}; const detail = {}; const why = {};
  const put = (f, v, s, d, w) => { inp[f] = ok(v) || (typeof v === 'string' && v) ? v : null; src[f] = inp[f] != null ? s : 'missing'; if (inp[f] != null && d) detail[f] = d; if (inp[f] == null) why[f] = w; };
  put('fundName', quote?.name || ref?.name || '', quote?.name ? 'fetched' : 'default', quote?.name ? 'Yahoo Finance' : 'Built-in reference list', 'name not returned');
  if (!inp.fundName) { inp.fundName = ''; src.fundName = 'manual'; }
  inp.fundType = ref?.type || (quote?.type === 'MUTUALFUND' ? 'Active Mutual Fund' : 'Index ETF'); src.fundType = ref ? 'default' : 'manual';
  inp.benchmark = ref?.benchmark || ''; src.benchmark = ref ? 'default' : 'manual';
  const manualOnly = profileErr ? `Alpha Vantage fund profile unavailable (${profileErr}) — enter it from the fund provider's page`
    : Keys.get('av') ? "Alpha Vantage didn't report it — enter it from the fund provider's page"
    : "not available without a key — add a free Alpha Vantage key under “Data keys”, or enter it from the fund provider's page";
  const pSrc = profile ? `Alpha Vantage ETF_PROFILE${profile.last_updated ? ` · updated ${profile.last_updated}` : ''}` : '';
  const pEr = num(profile?.net_expense_ratio);
  if (ok(pEr)) put('expenseRatio', pEr, 'fetched', pSrc);
  else put('expenseRatio', ref?.expenseRatio, 'default', 'Built-in reference list (verify against the prospectus)', manualOnly);
  put('price', quote?.price, 'fetched', quote ? `${quote.source} · as of ${quote.asOf}` : '', 'price lookup failed');
  inp.priceAsOf = quote?.asOf || null;
  put('aum', num(profile?.net_assets), 'fetched', pSrc + ' (net assets)', manualOnly + ' (used by the verdict\'s full screen)');
  for (const f of ['turnoverRatio', 'managerTenure', 'numHoldings', 'top10Concentration', 'activeShare', 'trackingError', 'premiumDiscount', 'taxCostRatio']) {
    inp[f] = null; src[f] = 'manual'; // optional context — no calculation uses these
  }
  if (profile) {
    const to = num(profile.portfolio_turnover);
    if (ok(to)) { inp.turnoverRatio = to; src.turnoverRatio = 'fetched'; detail.turnoverRatio = pSrc; }
    const h = Array.isArray(profile.holdings) ? profile.holdings.map(x => num(x.weight)).filter(ok) : [];
    if (h.length) {
      inp.numHoldings = h.length; src.numHoldings = 'fetched'; detail.numHoldings = `${pSrc} (holdings listed — may be capped for very large funds)`;
      inp.top10Concentration = h.sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0); src.top10Concentration = 'fetched'; detail.top10Concentration = `${pSrc} (sum of 10 largest weights)`;
    }
  }
  const rows = quote?.rows;
  const histSrc = (label) => `computed from Yahoo dividend-adjusted closes (total return${label})`;
  for (const [f, y] of [['return1y', 1], ['return3y', 3], ['return5y', 5], ['return10y', 10]]) {
    const r = rows ? trailingReturn(rows, y) : { val: null, why: 'no price history' };
    put(f, r.val, 'fetched', histSrc(y > 1 ? ', annualized' : ''), r.why);
  }
  const rf = tsy?.m3 ?? tsy?.y10 ?? DEFAULTS.treasury10yDefault;
  const st = rows ? riskStats(rows, rf, 5) : { why: 'no price history' };
  put('stdDev', st.stdDev, 'fetched', `annualized daily volatility, ${st.window}`, st.why);
  put('sharpeRatio', st.sharpe, 'fetched', `(CAGR − ${(rf * 100).toFixed(2)}% ${tsy?.m3 != null ? '3-mo T-bill' : 'risk-free'}) ÷ volatility, ${st.window}`, st.why);
  put('maxDrawdown', st.maxDrawdown, 'fetched', `peak-to-trough, ${st.window}`, st.why);
  put('yield', quote ? ttmDistributionYield(quote.dividends, quote.price, quote.asOf) : null, 'fetched', 'trailing-12-month distributions ÷ price (Yahoo)', 'no distribution history');
  const bWhy = inp.benchmark ? `no free total-return series for "${inp.benchmark}" — enter the benchmark return from the provider's page` : 'benchmark unknown — set it and enter its return';
  put('benchReturn5y', bench?.r5, 'fetched', bench ? `${bench.symbol} total-return index (Yahoo), annualized` : '', bench?.why5 || bWhy);
  put('benchReturn10y', bench?.r10, 'fetched', bench ? `${bench.symbol} total-return index (Yahoo), annualized` : '', bench?.why10 || bWhy);
  inp.__why = why;
  return { inp, src, detail };
}

function applyBondDefaults(quote, tsy, ticker) {
  const inp = { ticker }; const src = {}; const detail = {}; const why = {};
  const isFund = KNOWN_BOND_ETFS.has(ticker) || ['ETF', 'MUTUALFUND'].includes(quote?.type);
  inp.issuer = quote?.name || ETF_REFERENCE[ticker]?.name || ticker;
  inp.bondType = isFund ? 'Bond ETF' : 'Individual bond';
  inp.creditRating = ''; inp.taxStatus = 'Taxable';
  const manual = isFund ? "not available from free keyless sources — copy it from the fund's fact sheet" : 'no free feed prices individual bonds — enter from your broker or FINRA TRACE';
  for (const f of ['couponRate', 'parValue', 'yearsToMaturity', 'ytm', 'ytw', 'modDuration', 'convexity']) { inp[f] = null; src[f] = 'missing'; why[f] = manual; }
  if (isFund) { // per-bond fields don't describe a fund; don't flag them as gaps
    for (const f of ['couponRate', 'parValue', 'yearsToMaturity', 'convexity']) { src[f] = 'manual'; why[f] = 'per-bond field — not applicable to a fund'; }
  } else { inp.parValue = 100; src.parValue = 'default'; detail.parValue = 'Standard $100 par'; delete why.parValue; }
  if (quote) { inp.price = quote.price; src.price = 'fetched'; detail.price = `${quote.source} · as of ${quote.asOf}${isFund ? ' (fund share price)' : ''}`; inp.priceAsOf = quote.asOf; }
  else { inp.price = null; src.price = 'missing'; why.price = isFund ? 'price lookup failed' : manual; }
  if (isFund) {
    const dy = quote ? ttmDistributionYield(quote.dividends, quote.price, quote.asOf) : null;
    inp.distributionYield = ok(dy) ? dy : null; src.distributionYield = ok(dy) ? 'fetched' : 'missing';
    if (ok(dy)) detail.distributionYield = 'trailing-12-month distributions ÷ price (Yahoo) — an income yield, NOT yield-to-maturity'; else why.distributionYield = 'no distribution history';
  }
  const dflt = (f, v, d) => { inp[f] = v; src[f] = 'default'; detail[f] = d; };
  dflt('marginalTaxRate', 0.24, 'Workbook default');
  dflt('inflationAssumption', 0.035, 'Workbook default');
  dflt('defaultProbability', isFund ? 0.005 : 0.01, 'Workbook default');
  dflt('recoveryRate', 0.4, 'Workbook default');
  if (tsy) { inp.comparableTreasuryYield = tsy.y10; src.comparableTreasuryYield = 'fetched'; detail.comparableTreasuryYield = `US Treasury 10 Yr par yield · ${tsy.asOf}`; }
  else dflt('comparableTreasuryYield', DEFAULTS.treasury10yDefault, DEFAULTS.treasury10yAsOf);
  inp.__why = why;
  return { inp, src, detail };
}

function defaultPortfolio() { return { intendedPositionSize: 0.05, maxPositionSize: 0.10, timeHorizon: 10, liquidityNeed: 0, correlation: 0.5, role: '', conviction: 3 }; }
function defaultLynch() { return { lynchCategory: 'Stalwart', lynchStory: '', lynchInventoryNote: '—', lynchInsiderNote: '—', lynchDiworsification: 'No', lynchHotIndustry: 'No', lynchAccountingRedFlags: 'No', lynchExcessiveDebt: 'No', lynchStoryPricedIn: 'No' }; }

// Decide stock / fund / bond from what Yahoo says the instrument is, so typing VOO with
// "Stock" selected (or NKE with "Fund") doesn't run the wrong analysis on garbage inputs.
function resolveAssetType(requested, quote, ticker) {
  const t = quote?.type;
  const bondish = KNOWN_BOND_ETFS.has(ticker) || BONDISH_NAME.test(quote?.name || '');
  if (t === 'EQUITY' && requested !== 'stock') return { type: 'stock', note: `${ticker} is a stock — analyzing it as one.` };
  if ((t === 'ETF' || t === 'MUTUALFUND') && requested === 'stock') {
    const type = bondish ? 'bond' : 'fund';
    return { type, note: `${ticker} is ${t === 'ETF' ? 'an ETF' : 'a mutual fund'}, not an operating company — analyzing it as a ${type === 'bond' ? 'bond fund' : 'fund'}.` };
  }
  if (t && !['EQUITY', 'ETF', 'MUTUALFUND'].includes(t)) return { type: requested, note: `${ticker} is a ${t} instrument, which this tool isn't designed for — results may be meaningless.`, level: 'warn' };
  return { type: requested };
}

async function fetchBenchmark(benchmarkName) {
  const sym = BENCHMARK_TR[benchmarkName];
  if (!sym) return null;
  const q = await Fetcher.fetchQuote(sym).catch(() => null);
  if (!q) return { symbol: sym, why5: 'benchmark series fetch failed', why10: 'benchmark series fetch failed' };
  const r5 = trailingReturn(q.rows, 5), r10 = trailingReturn(q.rows, 10);
  return { symbol: sym, r5: r5.val, r10: r10.val, why5: r5.why, why10: r10.why };
}

async function analyzeTicker(rawTicker, requestedType) {
  const ticker = normalizeTicker(rawTicker);
  const statusEl = document.getElementById('fetchStatus');
  if (!ticker) {
    Fetcher.reset(); statusEl.hidden = false;
    Fetcher.note('err', `"${String(rawTicker).trim()}" doesn't look like a ticker symbol (letters, digits, "." or "-", up to 12 characters).`);
    return;
  }
  if (AppState.busy && AppState.busyTicker === ticker) return; // ignore double-clicks / Enter repeat
  const runId = ++AppState.runId; // a newer analysis supersedes this one (prevents stale results overwriting fresh ones)
  AppState.busy = true; AppState.busyTicker = ticker; AppState.logCollapsed = false;
  document.getElementById('tickerInput').value = ticker;
  Fetcher.reset(); statusEl.hidden = false;
  setAnalyzing(true);
  Fetcher.note('info', `Analyzing ${ticker}…`);
  let built = null;
  try {
    const [quote, tsy] = await Promise.all([Fetcher.fetchQuoteWithBackup(ticker), Fetcher.fetchTreasury().catch(() => null)]);
    if (runId !== AppState.runId) return;
    if (tsy) Fetcher.note('ok', `10yr Treasury ${(tsy.y10 * 100).toFixed(2)}% · 3-mo T-bill ${tsy.m3 != null ? (tsy.m3 * 100).toFixed(2) + '%' : 'n/a'} (treasury.gov, ${tsy.asOf}).`);
    else Fetcher.note('warn', `Couldn't reach treasury.gov — using the workbook's dated 10yr Treasury reference (${(DEFAULTS.treasury10yDefault * 100).toFixed(1)}%).`);

    const resolved = resolveAssetType(requestedType, quote, ticker);
    if (resolved.note) Fetcher.note(resolved.level || 'info', resolved.note);
    const type = resolved.type;
    setAssetType(type);

    const prev = await Store.get(`profile_v2:${ticker}`);
    if (type === 'stock') {
      const fetched = await Fetcher.fetchStockFundamentals(ticker);
      if (runId !== AppState.runId) return;
      if (!quote && fetched.failed) {
        Fetcher.note('err', `Nothing found for "${ticker}" in either Yahoo Finance or SEC EDGAR — check the symbol (class shares use a dash or dot, e.g. BRK-B). No report produced.`);
        return;
      }
      let ov = null;
      if (Keys.get('av')) {
        try {
          ov = await AV.call('OVERVIEW', { symbol: ticker.replace(/-/g, '.') });
          if (!ov?.Symbol) throw new Error('no company overview for this symbol');
          const secEps = fetched.values?.epsTTM, avEps = num(ov.DilutedEPSTTM);
          if (ok(secEps) && ok(avEps) && avEps !== 0) {
            const diff = Math.abs(secEps - avEps) / Math.abs(avEps);
            if (diff > 0.10) Fetcher.note('warn', `EPS cross-check: SEC-derived TTM EPS $${fmt.plain(secEps)} vs Alpha Vantage $${fmt.plain(avEps)} (${(diff * 100).toFixed(0)}% apart) — check for one-off items, a recent quarter one source hasn't picked up, or a share-class mismatch.`);
            else Fetcher.note('ok', `EPS cross-check passed: SEC $${fmt.plain(secEps)} vs Alpha Vantage $${fmt.plain(avEps)}.`);
          } else if (!ok(secEps) && ok(avEps)) Fetcher.note('ok', `EPS filled from Alpha Vantage ($${fmt.plain(avEps)}) because SEC XBRL had none — verify it's for this share class.`);
        } catch (e) { Fetcher.note('warn', `Alpha Vantage overview unavailable: ${e.message}. Continuing with SEC data only.`); ov = null; }
        if (runId !== AppState.runId) return;
      }
      built = applyStockDefaults(fetched, quote, tsy, ticker, ov);
    } else if (!quote && type === 'fund') { // (an individual bond with no quote is fine — it's a manual-entry sheet)
      Fetcher.note('err', `No price data found for "${ticker}" — check the symbol. No report produced.`);
      return;
    } else if (type === 'fund') {
      const benchName = ETF_REFERENCE[ticker]?.benchmark;
      const bench = benchName ? await fetchBenchmark(benchName) : null;
      if (runId !== AppState.runId) return;
      let profile = null, profileErr = null;
      if (Keys.get('av')) {
        try {
          profile = await AV.call('ETF_PROFILE', { symbol: ticker });
          if (!num(profile?.net_expense_ratio) && !num(profile?.net_assets)) throw new Error('no fund profile for this symbol (Alpha Vantage covers ETFs; many mutual funds are missing)');
          Fetcher.note('ok', `Alpha Vantage fund profile: expense ratio ${fmt.plain(num(profile.net_expense_ratio) * 100, 3)}%, net assets ${num(profile.net_assets) ? '$' + (num(profile.net_assets) / 1e9).toFixed(1) + 'B' : 'n/a'}${Array.isArray(profile.holdings) ? `, ${profile.holdings.length} holdings listed` : ''}.`);
        } catch (e) { profileErr = e.message; profile = null; Fetcher.note('warn', `Alpha Vantage fund profile unavailable: ${e.message}.`); }
        if (runId !== AppState.runId) return;
      }
      built = applyFundDefaults(quote, tsy, bench, ticker, profile, profileErr);
    } else {
      built = applyBondDefaults(quote, tsy, ticker);
    }

    // Keep anything the user typed in on a previous run of this ticker — the UI promises that.
    if (prev && prev.assetType === type && prev[type]) {
      const prevSrc = prev.fieldSource?.[type] || {};
      let kept = 0;
      for (const [f, s] of Object.entries(prevSrc)) if (s === 'manual' && prev[type][f] != null && f in built.inp) { built.inp[f] = prev[type][f]; built.src[f] = 'manual'; delete built.inp.__why[f]; kept++; }
      if (kept) Fetcher.note('info', `Kept ${kept} value${kept > 1 ? 's' : ''} you entered by hand last time.`);
    }

    AppState.ticker = ticker; AppState.assetType = type;
    AppState.stock = type === 'stock' ? built.inp : null; AppState.fund = type === 'fund' ? built.inp : null; AppState.bond = type === 'bond' ? built.inp : null;
    AppState.fieldSource = { [type]: built.src }; AppState.sourceDetail = { [type]: built.detail };
    AppState.portfolio = prev?.portfolio || AppState.portfolio || defaultPortfolio();
    AppState.lynch = prev?.lynch || defaultLynch(); // FIX: re-analyzing used to wipe the user's Lynch story & pitfalls
    if (type === 'stock' && !AppState.lynch.lynchStory) AppState.lynch.lynchStory = `${built.inp.companyName || ticker}: [describe the business in one paragraph — why do you own it?]`;
    AppState.priceHistory = compactHistory(quote?.rows);
    AppState.priceHistoryWhy = AppState.priceHistory ? null : quote ? `${quote.source} supplied a current price but no price history` : 'price lookup failed';
    AppState.warnings = Fetcher.log.filter(l => l.level === 'warn' || l.level === 'err').map(l => l.text);
    AppState.analyzedAt = Date.now();
    await saveProfile(ticker);
    await addToWatchlist(ticker, type);
    const gaps = Object.values(built.src).filter(s => s === 'missing').length;
    Fetcher.note(gaps ? 'warn' : 'ok', `Analysis complete for ${ticker}${gaps ? ` — ${gaps} input${gaps > 1 ? 's' : ''} could not be fetched (flagged in red; see "Data gaps").` : '.'}`);
  } catch (e) {
    console.error(e);
    if (runId === AppState.runId) Fetcher.note('err', `Unexpected error: ${e.message}`);
  } finally {
    if (runId === AppState.runId) {
      AppState.busy = false; AppState.busyTicker = null;
      // Keep the full log open when something failed outright; otherwise collapse it to one line.
      AppState.logCollapsed = !Fetcher.log.some(l => l.level === 'err');
      renderFetchStatus();
      setAnalyzing(false);
      if (AppState.ticker === ticker && AppState[AppState.assetType]) {
        document.getElementById('emptyState').hidden = true;
        document.getElementById('mainApp').hidden = false;
        AppState.activeTab = 'summary';
        renderApp();
      }
    }
  }
}

function recompute() { renderApp(); saveProfile(AppState.ticker); }

/* ---- persistence ---- */
async function saveProfile(ticker) {
  if (!ticker) return;
  await Store.set(`profile_v2:${ticker}`, {
    assetType: AppState.assetType, stock: AppState.stock, fund: AppState.fund, bond: AppState.bond,
    portfolio: AppState.portfolio, lynch: AppState.lynch, fieldSource: AppState.fieldSource,
    sourceDetail: AppState.sourceDetail, warnings: AppState.warnings, analyzedAt: AppState.analyzedAt,
    priceHistory: AppState.priceHistory, priceHistoryWhy: AppState.priceHistoryWhy,
  });
}
async function loadProfile(ticker) {
  const p = await Store.get(`profile_v2:${ticker}`);
  if (!p || !p[p.assetType]) return false;
  Object.assign(AppState, {
    ticker, assetType: p.assetType, stock: p.stock, fund: p.fund, bond: p.bond,
    portfolio: p.portfolio || defaultPortfolio(), lynch: p.lynch || defaultLynch(),
    fieldSource: p.fieldSource || {}, sourceDetail: p.sourceDetail || {}, warnings: p.warnings || [], analyzedAt: p.analyzedAt,
    priceHistory: p.priceHistory || null, priceHistoryWhy: p.priceHistory ? null : (p.priceHistoryWhy || 'no saved price history — click Analyze to refresh'),
  });
  return true;
}
async function addToWatchlist(ticker, assetType) {
  const settings = (await Store.get('settings')) || { watchlist: [] };
  settings.watchlist = (settings.watchlist || []).filter(w => w.ticker !== ticker);
  settings.watchlist.unshift({ ticker, assetType, at: Date.now() });
  settings.watchlist = settings.watchlist.slice(0, 10);
  settings.lastTicker = ticker;
  await Store.set('settings', settings);
  AppState.watchlist = settings.watchlist;
  renderWatchlist();
}
