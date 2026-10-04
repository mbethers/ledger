/* ============================================================================
   PART 1 — CONFIG, DEFAULTS, REFERENCE DATA
   ============================================================================ */

// Neutral defaults applied to a fresh ticker, mirroring the workbook's README.
// These are ASSUMPTIONS (marked "default" in the UI), never stand-ins for missing data.
const DEFAULTS = {
  qualitative: 3,           // moat, management, simplicity, stability, accountingQuality
  terminalGrowth: 0.025,
  requiredMOS: 0.30,
  growthCapIfHistory: 0.12, // expected growth seeded from 5yr EPS CAGR, capped here
  growthIfNoHistory: 0.05,
  discountFloor: 0.10,      // discount rate = max(10%, 10yr Treasury + 5%)
  discountTreasurySpread: 0.05,
  // No free, browser-accessible source publishes Moody's AAA yield (FRED needs a key), so
  // this stays a dated reference value. The 10yr Treasury IS fetched live from treasury.gov;
  // the default below is used only if that fetch fails.
  aaaYieldDefault: 0.048,
  treasury10yDefault: 0.043,
  aaaYieldAsOf: 'workbook reference value from 2026-08-12 — not live; update with a current Moody\'s AAA yield',
  treasury10yAsOf: 'workbook reference value from 2026-08-12 — live Treasury fetch failed',
};

// Static reference for a few very large ETFs (expense ratio & benchmark change rarely).
// Always editable; shown as "default", never as live data.
const ETF_REFERENCE = {
  VOO: { name: 'Vanguard S&P 500 ETF', benchmark: 'S&P 500', expenseRatio: 0.0003, type: 'Index ETF' },
  SPY: { name: 'SPDR S&P 500 ETF Trust', benchmark: 'S&P 500', expenseRatio: 0.000945, type: 'Index ETF' }, // FIX: was 0.0945 (9.45%)
  IVV: { name: 'iShares Core S&P 500 ETF', benchmark: 'S&P 500', expenseRatio: 0.0003, type: 'Index ETF' },
  VFIAX: { name: 'Vanguard 500 Index Fund Admiral', benchmark: 'S&P 500', expenseRatio: 0.0004, type: 'Index Mutual Fund' },
  FXAIX: { name: 'Fidelity 500 Index Fund', benchmark: 'S&P 500', expenseRatio: 0.00015, type: 'Index Mutual Fund' },
  VTI: { name: 'Vanguard Total Stock Market ETF', benchmark: 'CRSP US Total Market', expenseRatio: 0.0003, type: 'Index ETF' },
  QQQ: { name: 'Invesco QQQ Trust', benchmark: 'Nasdaq-100', expenseRatio: 0.0020, type: 'Index ETF' },
  VXUS: { name: 'Vanguard Total International Stock ETF', benchmark: 'FTSE Global All Cap ex US', expenseRatio: 0.0005, type: 'Index ETF' },
  VEA: { name: 'Vanguard FTSE Developed Markets ETF', benchmark: 'FTSE Developed All Cap ex US', expenseRatio: 0.0003, type: 'Index ETF' },
  VWO: { name: 'Vanguard FTSE Emerging Markets ETF', benchmark: 'FTSE Emerging Markets All Cap', expenseRatio: 0.0007, type: 'Index ETF' },
  BND: { name: 'Vanguard Total Bond Market ETF', benchmark: 'Bloomberg US Aggregate Bond', expenseRatio: 0.0003, type: 'Bond ETF' },
  AGG: { name: 'iShares Core US Aggregate Bond ETF', benchmark: 'Bloomberg US Aggregate Bond', expenseRatio: 0.0003, type: 'Bond ETF' },
  BNDX: { name: 'Vanguard Total International Bond ETF', benchmark: 'Bloomberg Global Aggregate ex-USD', expenseRatio: 0.0007, type: 'Bond ETF' },
  TLT: { name: 'iShares 20+ Year Treasury Bond ETF', benchmark: 'ICE US Treasury 20+ Year', expenseRatio: 0.0015, type: 'Bond ETF' },
  IEF: { name: 'iShares 7-10 Year Treasury Bond ETF', benchmark: 'ICE US Treasury 7-10 Year', expenseRatio: 0.0015, type: 'Bond ETF' },
  SHY: { name: 'iShares 1-3 Year Treasury Bond ETF', benchmark: 'ICE US Treasury 1-3 Year', expenseRatio: 0.0015, type: 'Bond ETF' },
  LQD: { name: 'iShares iBoxx $ Investment Grade Corporate Bond ETF', benchmark: 'Markit iBoxx USD Liquid Investment Grade', expenseRatio: 0.0014, type: 'Bond ETF' },
  HYG: { name: 'iShares iBoxx $ High Yield Corporate Bond ETF', benchmark: 'Markit iBoxx USD Liquid High Yield', expenseRatio: 0.0049, type: 'Bond ETF' },
  VNQ: { name: 'Vanguard Real Estate ETF', benchmark: 'MSCI US Investable Market Real Estate 25/50', expenseRatio: 0.0013, type: 'Index ETF' },
  GLD: { name: 'SPDR Gold Shares', benchmark: 'Gold spot price', expenseRatio: 0.0040, type: 'Index ETF' },
  SCHD: { name: 'Schwab US Dividend Equity ETF', benchmark: 'Dow Jones US Dividend 100', expenseRatio: 0.0006, type: 'Index ETF' },
  VUG: { name: 'Vanguard Growth ETF', benchmark: 'CRSP US Large Cap Growth', expenseRatio: 0.0004, type: 'Index ETF' },
  VTV: { name: 'Vanguard Value ETF', benchmark: 'CRSP US Large Cap Value', expenseRatio: 0.0004, type: 'Index ETF' },
};

// Benchmarks with a free total-return series on Yahoo (so excess return can be computed).
const BENCHMARK_TR = { 'S&P 500': '^SP500TR' };

const KNOWN_BOND_ETFS = new Set(['BND', 'AGG', 'BNDX', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'MUB', 'VCIT', 'VCSH', 'TIP', 'SCHZ', 'GOVT',
  'BSV', 'BIV', 'BLV', 'VGIT', 'VGSH', 'VGLT', 'EMB', 'JNK', 'SGOV', 'BIL', 'VTEB', 'BNDW', 'IUSB', 'USHY', 'FLOT', 'STIP', 'VTIP', 'SCHP', 'SPTL', 'IGSB', 'VTBLX', 'VBTLX']);
const BONDISH_NAME = /\b(bond|treasury|treasuries|fixed income|aggregate|municipal|muni|tips|t-bill|govt|government|corporate debt|high yield)\b/i;

// Human labels for inputs, used in "needs X" explanations.
const FIELD_LABEL = {
  price: 'current price', epsTTM: 'EPS', dilutedShares: 'share count', totalEquity: "shareholders' equity", revenue: 'revenue',
  netIncome: 'net income', da: 'D&A', capex: 'capex', operatingCashFlow: 'operating cash flow', totalCurrentAssets: 'current assets',
  totalCurrentLiabilities: 'current liabilities', totalLiabilities: 'total liabilities', totalDebt: 'total debt', cash: 'cash',
  ebit: 'EBIT', interestExpense: 'interest expense', dividendsPaid: 'dividends paid', expectedGrowth: 'expected growth',
  discountRate: 'discount rate', terminalGrowth: 'terminal growth', aaaYield: 'AAA yield', goodwill: 'goodwill', intangibles: 'intangibles',
  shortTermInvestments: 'short-term investments', avgROE: 'average ROE', avgROIC: 'ROIC', revCAGR5: '5yr revenue CAGR', epsCAGR5: '5yr EPS CAGR',
  epsCAGR10: '10yr EPS CAGR', grossMarginStdDev: 'gross-margin std dev', debtEquity: 'debt/equity', yearsPositiveEarnings: 'years of positive earnings',
  yearsDividends: 'years of dividends', grossProfit: 'gross profit', totalAssets: 'total assets', longTermDebt: 'long-term debt',
  fcfCAGR5: '5yr FCF CAGR', sbc: 'share-based comp', treasury10y: '10yr Treasury yield', requiredMOS: 'required margin of safety',
  // fund / bond
  expenseRatio: 'expense ratio', aum: 'AUM', return1y: '1yr return', return3y: '3yr return', return5y: '5yr return', return10y: '10yr return',
  benchReturn5y: 'benchmark 5yr return', benchReturn10y: 'benchmark 10yr return', sharpeRatio: 'Sharpe ratio', stdDev: 'std deviation',
  maxDrawdown: 'max drawdown', yield: 'yield', couponRate: 'coupon rate', parValue: 'par value', yearsToMaturity: 'years to maturity',
  ytm: 'yield to maturity', ytw: 'yield to worst', modDuration: 'modified duration', marginalTaxRate: 'marginal tax rate',
  inflationAssumption: 'inflation assumption', defaultProbability: 'default probability', recoveryRate: 'recovery rate',
  comparableTreasuryYield: 'comparable Treasury yield', distributionYield: 'distribution yield',
};

/* ============================================================================
   PART 2 — UTILITIES
   ============================================================================ */

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function esc(v) { return v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Rendered wherever a number can't be produced. Always says so, and why — never a blank or a fake 0.
function unav(why, word = 'Unavailable') {
  return `<span class="unavail" title="${esc(why || '')}">${word}${why ? `<small>${esc(why)}</small>` : ''}</span>`;
}

const fmt = {
  usd(v, opts = {}) {
    if (!ok(v)) return unav(opts.why);
    const abs = Math.abs(v), sign = v < 0 ? '-' : '';
    if (opts.abbreviate !== false && abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
    if (opts.abbreviate !== false && abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (opts.abbreviate !== false && abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: opts.decimals ?? 2, maximumFractionDigits: opts.decimals ?? 2 })}`;
  },
  price(v, why) { if (!ok(v)) return unav(why); return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; },
  num(v, dp = 2, why) { if (!ok(v)) return unav(why); return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); },
  pct(v, dp = 1, why) { if (typeof v === 'string') return esc(v); if (!ok(v)) return unav(why); return `${(v * 100).toFixed(dp)}%`; },
  x(v, dp = 1, why) { if (typeof v === 'string') return esc(v); if (!ok(v)) return unav(why); return `${v.toFixed(dp)}x`; },
  int(v, why) { if (!ok(v)) return unav(why); return Math.round(v).toLocaleString('en-US'); },
  plain(v, dp = 2) { return ok(v) ? v.toFixed(dp) : 'n/a'; },
};

// Persistent storage: the artifact host's window.storage if present, else localStorage,
// else in-memory. Every access is guarded — storage can be blocked or full.
const Store = (() => {
  const mem = {};
  const hasHost = typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function';
  const ls = (() => { try { const k = '__ledger_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch (e) { return null; } })();
  return {
    async get(key) {
      try {
        if (hasHost) { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : (mem[key] ?? null); }
        if (ls) { const r = ls.getItem('ledger:' + key); return r ? JSON.parse(r) : (mem[key] ?? null); }
      } catch (e) { /* fall through */ }
      return mem[key] ?? null;
    },
    async set(key, value) {
      mem[key] = value;
      try {
        if (hasHost) await window.storage.set(key, JSON.stringify(value));
        else if (ls) ls.setItem('ledger:' + key, JSON.stringify(value));
      } catch (e) { /* quota or blocked — in-memory copy still works for this session */ }
    },
  };
})();

// CSV parser for simple exports (handles quoted header cells like "10 Yr").
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const clean = (s) => s.trim().replace(/^"|"$/g, '');
  const headers = lines[0].split(',').map(clean);
  return lines.slice(1).filter(Boolean).map(line => {
    const cells = line.split(',').map(clean); const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function sampleStdev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// "SPY", " brk.b ", "$nke" → canonical form used by SEC & Yahoo (class shares use a dash).
function normalizeTicker(raw) {
  const t = String(raw || '').trim().toUpperCase().replace(/^\$/, '').replace(/[./]/g, '-');
  return /^[A-Z0-9^][A-Z0-9-=^]{0,11}$/.test(t) ? t : null;
}

/* ============================================================================
   PART 3 — CALCULATION ENGINE
   Mirrors the workbook's formulas (sheet!cell noted inline). Every output is
   either a real number or null with an entry in `why` explaining what's missing.
   Missing inputs are never coerced to 0 — that was the root of the original
   "plausible but partially empty" analyses (e.g. a 0 P/E passing Graham's ≤15 test).
   ============================================================================ */

function makeNeed(inp) {
  return (fields) => {
    const m = fields.filter(f => !ok(inp[f]));
    if (!m.length) return null;
    const detail = m.length === 1 && inp.__why?.[m[0]] ? ` — ${inp.__why[m[0]]}` : '';
    return `needs ${m.map(f => FIELD_LABEL[f] || f).join(', ')}${detail}`;
  };
}

function computeValuation(inp) {
  const out = { why: {} }; const why = out.why; const need = makeNeed(inp);
  const set = (k, reason, fn) => {
    if (reason) { out[k] = null; why[k] = reason; return null; }
    const v = fn();
    if (!ok(v)) { out[k] = null; why[k] = 'not computable from these inputs (division by zero?)'; return null; }
    return (out[k] = v);
  };
  const dep = (...ks) => { for (const k of ks) if (!ok(out[k])) return why[k] || `needs ${k}`; return null; };

  set('marketCapV', need(['price', 'dilutedShares']), () => inp.price * inp.dilutedShares); // Inputs_Stock!C13 / Valuation C16
  out.marketCap = out.marketCapV; why.marketCap = why.marketCapV;
  set('fcf', need(['operatingCashFlow', 'capex']), () => inp.operatingCashFlow - inp.capex); // C42 / C12
  out.freeCashFlow = out.fcf; why.freeCashFlow = why.fcf;
  set('epsTTM', need(['epsTTM']), () => inp.epsTTM); // C7
  set('bookValuePerShare', need(['totalEquity', 'dilutedShares']), () => inp.totalEquity / inp.dilutedShares); // C8
  set('tangibleBookPerShare', need(['totalEquity', 'goodwill', 'intangibles', 'dilutedShares']), () => (inp.totalEquity - inp.goodwill - inp.intangibles) / inp.dilutedShares); // C9
  set('ncav', need(['totalCurrentAssets', 'totalLiabilities']), () => inp.totalCurrentAssets - inp.totalLiabilities); // C10
  set('ncavPerShare', dep('ncav') || need(['dilutedShares']), () => out.ncav / inp.dilutedShares); // C11
  set('fcfPerShare', dep('fcf') || need(['dilutedShares']), () => out.fcf / inp.dilutedShares); // C13
  set('ownerEarnings', need(['netIncome', 'da', 'capex']), () => inp.netIncome + inp.da - inp.capex); // C14
  set('ownerEarningsPerShare', dep('ownerEarnings') || need(['dilutedShares']), () => out.ownerEarnings / inp.dilutedShares); // C15
  set('currentRatio', need(['totalCurrentAssets', 'totalCurrentLiabilities']) || (inp.totalCurrentLiabilities <= 0 ? 'current liabilities ≤ 0' : null), () => inp.totalCurrentAssets / inp.totalCurrentLiabilities); // C17
  out.equityNegative = ok(inp.totalEquity) && inp.totalEquity <= 0;
  set('debtToEquity', need(['totalDebt', 'totalEquity']) || (out.equityNegative ? "shareholders' equity ≤ 0 — D/E not meaningful" : null), () => inp.totalDebt / inp.totalEquity); // C18
  if (!ok(inp.interestExpense)) { out.interestCoverage = null; why.interestCoverage = need(['interestExpense']); } // C19
  else if (inp.interestExpense === 0) { out.interestCoverage = 'n/a'; why.interestCoverage = 'no interest expense'; }
  else set('interestCoverage', need(['ebit']), () => inp.ebit / inp.interestExpense);
  set('netMargin', need(['netIncome', 'revenue']) || (inp.revenue <= 0 ? 'revenue ≤ 0' : null), () => inp.netIncome / inp.revenue); // C20
  set('roe', need(['avgROE']), () => inp.avgROE); // C21
  set('roic', need(['avgROIC']), () => inp.avgROIC); // C22
  set('ownerEarningsYield', dep('ownerEarnings', 'marketCapV'), () => out.ownerEarnings / out.marketCapV); // C23
  set('fcfYield', dep('fcf', 'marketCapV'), () => out.fcf / out.marketCapV); // C24
  set('earningsYield', need(['epsTTM', 'price']), () => inp.epsTTM / inp.price); // C25
  out.peNegative = ok(inp.epsTTM) && inp.epsTTM <= 0;
  set('peTTM', need(['price', 'epsTTM']) || (out.peNegative ? `EPS is $${fmt.plain(inp.epsTTM)} (≤ 0) — P/E isn't meaningful for a loss` : null), () => inp.price / inp.epsTTM); // C26
  out.pbNegative = ok(out.bookValuePerShare) && out.bookValuePerShare <= 0;
  set('pb', need(['price']) || dep('bookValuePerShare') || (out.pbNegative ? 'book value ≤ 0 — P/B not meaningful' : null), () => inp.price / out.bookValuePerShare); // C27
  set('dividendYield', need(['dividendsPaid']) || dep('marketCapV'), () => inp.dividendsPaid / out.marketCapV); // C28

  // ---- DCF on owner earnings (H5:H28) ----
  const dcfWhy = dep('ownerEarnings') || need(['expectedGrowth', 'discountRate', 'terminalGrowth', 'cash', 'totalDebt', 'dilutedShares']);
  out.dcfYears = [];
  if (dcfWhy) { out.dcf = null; why.dcf = dcfWhy; }
  else {
    const H5 = out.ownerEarnings, H6 = inp.expectedGrowth, H7 = inp.discountRate, H8 = inp.terminalGrowth;
    const H9 = inp.cash + (ok(inp.shortTermInvestments) ? inp.shortTermInvestments : 0), H10 = inp.totalDebt, H11 = inp.dilutedShares;
    for (let yr = 1; yr <= 10; yr++) {
      const fcfYear = H5 * Math.pow(1 + H6, yr), discFactor = 1 / Math.pow(1 + H7, yr);
      out.dcfYears.push({ yr, fcfYear, discFactor, pv: fcfYear * discFactor });
    }
    const sanityOk = H7 > H8;
    const H23 = out.dcfYears[9].fcfYear, I23 = out.dcfYears[9].discFactor;
    const H24 = sanityOk ? H23 * (1 + H8) / (H7 - H8) : null;
    const H25 = sanityOk ? H24 * I23 : null;
    const H26 = sanityOk ? out.dcfYears.reduce((s, y) => s + y.pv, 0) + H25 : null;
    const H27 = sanityOk ? H26 + H9 - H10 : null;
    const H28 = sanityOk && H11 > 0 ? H27 / H11 : null;
    out.dcf = { baseOwnerEarnings: H5, g: H6, r: H7, termGrowth: H8, excessCash: H9, totalDebt: H10, shares: H11,
      terminalValue: H24, pvTerminal: H25, enterpriseValue: H26, equityValue: H27, valuePerShare: H28, sanityOk };
    if (!sanityOk) why.dcf = 'discount rate must exceed terminal growth';
  }

  // ---- five intrinsic-value methods (C32:C37). A computed value ≤ 0 is reported as such. ----
  const method = (k, reason, fn, nonPositiveWhy) => {
    if (reason) { out[k] = null; why[k] = reason; return; }
    const v = fn();
    if (!ok(v)) { out[k] = null; why[k] = 'not computable from these inputs'; return; }
    if (v <= 0) { out[k] = null; why[k] = nonPositiveWhy(v); return; }
    out[k] = v;
  };
  const mos = (k) => (ok(out[k]) && ok(inp.price) ? (out[k] - inp.price) / out[k] : 'n/a');
  const signal = (k) => (ok(out[k]) && ok(inp.price) ? (inp.price <= out[k] ? 'Undervalued' : 'Overvalued') : 'n/a');

  method('grahamNumber', need(['epsTTM']) || dep('bookValuePerShare') || (inp.epsTTM <= 0 ? 'EPS ≤ 0 — Graham Number undefined' : out.bookValuePerShare <= 0 ? 'book value ≤ 0 — Graham Number undefined' : null),
    () => Math.sqrt(22.5 * inp.epsTTM * out.bookValuePerShare), () => 'undefined');
  method('grahamRevised', need(['epsTTM', 'expectedGrowth', 'aaaYield']) || (inp.aaaYield <= 0 ? 'AAA yield ≤ 0' : null),
    () => inp.epsTTM * (8.5 + 2 * inp.expectedGrowth * 100) * 4.4 / (inp.aaaYield * 100), v => `formula gives ${fmt.price(v)} (≤ 0) — negative EPS or growth`);
  method('netNet', dep('ncavPerShare'), () => (2 / 3) * out.ncavPerShare, () => 'current assets don\'t cover total liabilities (NCAV ≤ 0) — not a net-net');
  method('lynchFairValue', need(['epsTTM', 'expectedGrowth']), () => inp.epsTTM * (inp.expectedGrowth * 100), v => `formula gives ${fmt.price(v)} (≤ 0) — negative EPS or growth`);
  method('dcfIntrinsic', why.dcf || (out.dcf && !ok(out.dcf.valuePerShare) ? 'DCF not computable' : null), () => out.dcf.valuePerShare, v => `DCF equity value is ${fmt.price(v)}/share (≤ 0) — debt exceeds discounted owner earnings`);
  for (const k of ['grahamNumber', 'grahamRevised', 'netNet', 'lynchFairValue', 'dcfIntrinsic']) { out[k + 'MOS'] = mos(k); out[k + 'Signal'] = signal(k); }
  out.dcfMOS = out.dcfIntrinsicMOS; out.dcfSignal = out.dcfIntrinsicSignal;

  set('lynchPEG', dep('peTTM') || need(['expectedGrowth']) || (inp.expectedGrowth <= 0 ? `expected growth is ${fmt.pct(inp.expectedGrowth)} (≤ 0) — PEG undefined` : null), () => out.peTTM / (inp.expectedGrowth * 100)); // C36
  out.lynchPEGSignal = !ok(out.lynchPEG) ? 'n/a' : out.lynchPEG < 1 ? 'Undervalued' : out.lynchPEG <= 1.5 ? 'Fair' : 'Overvalued';

  const mosList = ['grahamNumberMOS', 'grahamRevisedMOS', 'netNetMOS', 'lynchFairValueMOS', 'dcfMOS'].map(k => out[k]);
  out.methodsEvaluated = mosList.filter(ok).length;
  out.methodsPassingMOS = mosList.filter(v => ok(v) && v >= inp.requiredMOS).length; // C41

  const q = ['moat', 'management', 'simplicity', 'stability', 'accountingQuality'];
  out.qualityScore = q.every(f => ok(inp[f])) ? q.reduce((s, f) => s + inp[f], 0) / 25 * 100 : null; // C42

  out.verdict = (() => { // C43 (+ explicit INCOMPLETE states the workbook didn't need, since it never had gaps)
    if (!ok(inp.price)) return 'INCOMPLETE — no current price';
    if (ok(out.ownerEarnings) && out.ownerEarnings < 0) return 'AVOID — negative owner earnings';
    if (ok(inp.accountingQuality) && inp.accountingQuality <= 1) return 'AVOID — low accounting quality';
    if (ok(inp.simplicity) && inp.simplicity <= 1) return 'AVOID — not understandable';
    if (out.methodsEvaluated === 0) return 'INCOMPLETE — no valuation method could be computed';
    if (out.methodsPassingMOS >= 2 && out.qualityScore >= 60) return 'UNDERVALUED — meets value criteria';
    if (out.methodsPassingMOS >= 1) return 'WATCH — fairly valued / mixed signals';
    return 'OVERVALUED — price exceeds intrinsic value';
  })();

  out.completenessFields = ['price', 'dilutedShares', 'revenue', 'ebit', 'netIncome', 'da', 'epsTTM', 'cash', 'totalCurrentAssets',
    'totalCurrentLiabilities', 'totalDebt', 'totalLiabilities', 'totalEquity', 'operatingCashFlow', 'capex', 'revCAGR5', 'epsCAGR5',
    'avgROE', 'avgROIC', 'moat', 'management', 'simplicity', 'accountingQuality', 'expectedGrowth', 'discountRate', 'aaaYield', 'requiredMOS'];
  out.filledCount = out.completenessFields.filter(f => ok(inp[f])).length;
  out.confidence = (() => { // C44 — dispersion now uses only methods that actually produced a value
    const nums = [out.grahamNumber, out.grahamRevised, out.lynchFairValue, out.dcfIntrinsic].filter(ok);
    const part1 = nums.length >= 2 ? 0.4 * Math.max(0, 100 - (sampleStdev(nums) / mean(nums)) * 100) : 0;
    const part2 = 0.3 * Math.min(100, (out.filledCount / out.completenessFields.length) * 100);
    const part3 = ok(inp.revCAGR5) && ok(inp.epsCAGR5) ? 0.2 * Math.max(0, 100 - Math.abs(inp.revCAGR5 - inp.epsCAGR5) * 100) : 0;
    const part4 = ok(inp.moat) ? 0.1 * (inp.moat / 5) * 100 : 0;
    return Math.round(part1 + part2 + part3 + part4);
  })();
  return out;
}

// Checklist rows: PASS / FAIL / NO DATA / UNVERIFIED. A missing input is never a PASS.
function checkRow(label, threshold, fmtKind, actual, test, o = {}) {
  let pass, note = o.note || '';
  if (o.forceFail) { pass = 'FAIL'; note = o.forceFail; }
  else if (!ok(actual)) { pass = 'NO DATA'; note = o.why || 'input unavailable'; }
  else pass = test(actual) ? 'PASS' : 'FAIL';
  if (pass === 'FAIL' && o.unverifiedIf && o.unverifiedIf(actual)) { pass = 'UNVERIFIED'; note = o.unverifiedNote; }
  return { label, threshold, fmt: fmtKind, actual, pass, note };
}
function passSummary(list, total) {
  const p = list.filter(x => x.pass === 'PASS').length, nd = list.filter(x => x.pass === 'NO DATA' || x.pass === 'UNVERIFIED').length;
  return `${p}/${total} pass${nd ? ` · ${nd} unverifiable` : ''}`;
}

function computeGrahamChecklist(inp, val) {
  const D = {}; const w = val.why; const iw = inp.__why || {};
  const histNote = (n) => `only ${n} fiscal years of SEC XBRL data exist (filings before ~2009 aren't machine-readable), so this can't be fully verified here`;
  D.defensiveList = [
    checkRow('Adequate size (market cap ≥ $500M)', 500000000, 'usd', val.marketCapV, a => a >= 5e8, { why: w.marketCapV }),
    checkRow('Strong financial condition (current ratio ≥ 2.0)', 2, 'x', val.currentRatio, a => a >= 2, { why: w.currentRatio }),
    checkRow('Earnings stability (≥10 yrs positive)', 10, 'int', inp.yearsPositiveEarnings, a => a >= 10, { why: iw.yearsPositiveEarnings,
      unverifiedIf: a => ok(inp.yearsPositiveEarningsOf) && inp.yearsPositiveEarningsOf < 10 && a === inp.yearsPositiveEarningsOf, unverifiedNote: histNote(inp.yearsPositiveEarningsOf) }),
    checkRow('Dividend record (≥20 yrs paid)', 20, 'int', inp.yearsDividends, a => a >= 20, { why: iw.yearsDividends,
      unverifiedIf: a => ok(inp.yearsDividendsOf) && inp.yearsDividendsOf < 20 && a === inp.yearsDividendsOf, unverifiedNote: `paid in all ${inp.yearsDividendsOf} years on record — ${histNote(inp.yearsDividendsOf)}` }),
    checkRow('Earnings growth (≥33% over 10yr)', 0.33, 'pct', ok(inp.epsCAGR10) ? Math.pow(1 + inp.epsCAGR10, 10) - 1 : null, a => a >= 0.33, { why: iw.epsCAGR10 || 'needs 10yr EPS CAGR' }),
    checkRow('Moderate P/E (≤ 15)', 15, 'x', val.peTTM, a => a <= 15, { why: w.peTTM, forceFail: val.peNegative ? 'negative earnings' : null }),
    checkRow('Moderate P/B (≤ 1.5)', 1.5, 'x', val.pb, a => a <= 1.5, { why: w.pb, forceFail: val.pbNegative ? 'negative book value' : null }),
    checkRow('P/E × P/B ≤ 22.5', 22.5, 'num', ok(val.peTTM) && ok(val.pb) ? val.peTTM * val.pb : null, a => a <= 22.5, { why: w.peTTM || w.pb, forceFail: val.peNegative || val.pbNegative ? 'negative earnings or book value' : null }),
  ];
  D.defensivePassCount = passSummary(D.defensiveList, 8);
  const mosNums = [val.grahamNumberMOS, val.grahamRevisedMOS, val.lynchFairValueMOS, val.dcfMOS].filter(ok);
  D.enterprisingList = [
    checkRow('Positive earnings some years (≥5 yrs)', 5, 'int', inp.yearsPositiveEarnings, a => a >= 5, { why: iw.yearsPositiveEarnings }),
    checkRow('Current ratio ≥ 1.5', 1.5, 'x', val.currentRatio, a => a >= 1.5, { why: w.currentRatio }),
    checkRow('Debt ≤ 110% of equity', 1.1, 'x', val.debtToEquity, a => a <= 1.1, { why: w.debtToEquity, forceFail: val.equityNegative ? 'negative equity' : null }),
    checkRow('Dividends some history (≥4 yrs)', 4, 'int', inp.yearsDividends, a => a >= 4, { why: iw.yearsDividends }),
    checkRow('P/E reasonable (≤ 20)', 20, 'x', val.peTTM, a => a <= 20, { why: w.peTTM, forceFail: val.peNegative ? 'negative earnings' : null }),
    checkRow('P/B reasonable (≤ 2.0)', 2, 'x', val.pb, a => a <= 2, { why: w.pb, forceFail: val.pbNegative ? 'negative book value' : null }),
    checkRow('Margin of safety ≥ 25% (best method)', 0.25, 'pct', mosNums.length ? Math.max(...mosNums) : null, a => a >= 0.25, { why: 'no valuation method produced a margin of safety' }),
  ];
  D.enterprisingPassCount = passSummary(D.enterprisingList, 7);
  return D;
}

function computeBuffettChecklist(inp, val) {
  const iw = inp.__why || {};
  const S = (score, whyMissing) => (score == null ? { score: null, missing: whyMissing } : { score });
  const list = [
    { label: 'Understandable business', why: 'Stay within your circle of competence', ...S(ok(inp.simplicity) ? inp.simplicity : null, 'not scored') },
    { label: 'Durable competitive advantage (moat)', why: 'Pricing power, switching costs, scale, network', ...S(ok(inp.moat) ? inp.moat : null, 'not scored') },
    { label: 'Consistent high ROE', why: '≥20% excellent, 12–20% ok', ...S(ok(inp.avgROE) ? (inp.avgROE >= 0.2 ? 5 : inp.avgROE >= 0.12 ? 3 : 1) : null, iw.avgROE || 'ROE unavailable') },
    // References the separately-tracked D/E "reference figure" (Inputs_Stock!C51), as the workbook does.
    { label: 'Low leverage', why: 'D/E ≤0.5 strong (reference figure)', ...S(ok(inp.debtEquity) ? (inp.debtEquity <= 0.5 ? 5 : inp.debtEquity <= 1 ? 3 : 1) : (ok(inp.totalEquity) && inp.totalEquity <= 0 ? 1 : null), iw.debtEquity || 'D/E unavailable') },
    { label: 'Capable, shareholder-oriented management', why: 'Allocates capital rationally; honest', ...S(ok(inp.management) ? inp.management : null, 'not scored') },
    { label: 'Retained earnings create value', why: 'ROE > cost of capital', ...S(ok(inp.avgROE) && ok(inp.discountRate) ? (inp.avgROE > inp.discountRate ? 5 : 2) : null, iw.avgROE || 'ROE unavailable') },
    { label: 'Predictable owner earnings', why: 'Stable, growing revenue and EPS', ...S(ok(inp.revCAGR5) && ok(inp.epsCAGR5) ? ((inp.revCAGR5 > 0 && inp.epsCAGR5 > 0) ? 5 : 2) : (inp.revCAGR5Neg || inp.epsCAGR5Neg ? 2 : null), iw.epsCAGR5 || iw.revCAGR5 || 'growth history unavailable') },
    // FIX (kept from prior build): an un-priceable DCF shouldn't score a perfect 5 — but a DCF that
    // couldn't run for lack of DATA is "no data", not a judgement.
    { label: 'Purchase below intrinsic value', why: 'DCF margin of safety', ...S(ok(val.dcfMOS) ? (val.dcfMOS >= inp.requiredMOS ? 5 : (val.dcfMOS >= 0 ? 3 : 1)) : (val.why.dcf ? null : 1), val.why.dcf || val.why.dcfIntrinsic) },
    { label: 'Pricing power / margin stability', why: 'Low gross-margin std dev', ...S(ok(inp.grossMarginStdDev) ? (inp.grossMarginStdDev <= 0.05 ? 5 : inp.grossMarginStdDev <= 0.1 ? 3 : 1) : null, iw.grossMarginStdDev || 'gross margin history unavailable') },
  ];
  const scored = list.filter(x => x.score != null);
  const f = { list, scoredCount: scored.length };
  f.qualityScore = scored.length ? scored.reduce((s, x) => s + x.score, 0) / (5 * scored.length) * 100 : null; // C17 (normalised to factors with data)
  f.grade = !ok(f.qualityScore) ? 'n/a — no factors scorable' : (f.qualityScore >= 80 ? 'A — excellent' : f.qualityScore >= 65 ? 'B — acceptable' : f.qualityScore >= 50 ? 'C — weak' : 'D — avoid');
  if (ok(f.qualityScore) && scored.length < 9) f.grade += ` (${scored.length}/9 factors)`;
  return f;
}

function computeLynchChecklist(inp, val) {
  const L = {};
  L.category = inp.lynchCategory; L.story = inp.lynchStory;
  L.peTTM = val.peTTM; L.expectedGrowth = inp.expectedGrowth; L.peg = val.lynchPEG;
  L.pegDivAdj = ok(val.peTTM) && ok(inp.expectedGrowth) && ok(val.dividendYield) && (inp.expectedGrowth + val.dividendYield) > 0
    ? val.peTTM / (inp.expectedGrowth * 100 + val.dividendYield * 100) : null; // C17
  L.debtToEquity = val.debtToEquity; L.dividendYield = val.dividendYield;
  L.pegSignal = val.lynchPEGSignal; // C24
  L.pitfalls = [inp.lynchDiworsification, inp.lynchHotIndustry, inp.lynchAccountingRedFlags, inp.lynchExcessiveDebt, inp.lynchStoryPricedIn];
  // FIX (kept): the workbook's C37 OR() omitted pitfall #5 ("story priced in").
  L.verdict = (() => {
    if (L.category === 'Cyclical') return 'Check cycle position — P/E logic inverted';
    if (L.pitfalls.includes('Yes')) return 'AVOID — pitfall present';
    // FIX: a missing PEG used to read as 0, and `0 < 1` made shrinking companies "UNDERVALUED".
    if (ok(inp.expectedGrowth) && inp.expectedGrowth <= 0) return 'NO PEG SIGNAL — expected growth ≤ 0, so PEG is undefined';
    if (!ok(L.peg)) return 'INCOMPLETE — PEG unavailable';
    if (L.peg < 1) return 'UNDERVALUED — PEG<1, story intact';
    if (L.peg <= 1.5) return 'WATCH — fairly valued';
    return 'OVERVALUED — PEG>1.5';
  })();
  return L;
}

function computeFundsETFs(f) {
  const c = { why: {} }; const need = makeNeed(f);
  const diff = (a, b, k) => { const r = need([a, b]); if (r) { c.why[k] = r; return null; } return f[a] - f[b]; };
  c.excessReturn5y = diff('return5y', 'benchReturn5y', 'excessReturn5y');
  c.excessReturn10y = diff('return10y', 'benchReturn10y', 'excessReturn10y');
  c.feeDrag10y = ok(f.expenseRatio) ? 1 - Math.pow(1 - f.expenseRatio, 10) : null; if (!ok(c.feeDrag10y)) c.why.feeDrag10y = need(['expenseRatio']);
  c.trackingDifference5y = c.excessReturn5y; c.why.trackingDifference5y = c.why.excessReturn5y;
  c.netCostPer10k = ok(c.trackingDifference5y) ? 10000 * c.trackingDifference5y : null; c.why.netCostPer10k = c.why.excessReturn5y;
  c.caveats = [];
  c.verdict = (() => {
    if (!ok(f.expenseRatio)) return 'INCOMPLETE — expense ratio needed';
    const fullScreenKnown = ok(f.aum) && ok(c.excessReturn5y) && ok(f.sharpeRatio);
    if (fullScreenKnown && f.expenseRatio <= 0.0005 && f.aum >= 1e9 && c.excessReturn5y >= 0 && f.sharpeRatio >= 0.5) return 'FAVORABLE — low cost, tracks well, acceptable risk-adjusted';
    if (f.expenseRatio <= 0.0005) {
      if (!fullScreenKnown) c.caveats.push(`Full screen not evaluated — ${[!ok(f.aum) && 'AUM', !ok(c.excessReturn5y) && 'benchmark 5yr return', !ok(f.sharpeRatio) && 'Sharpe ratio'].filter(Boolean).join(', ')} unavailable.`);
      return 'FAVORABLE for index — low cost';
    }
    if (!ok(c.excessReturn5y) || !ok(f.sharpeRatio)) return 'INCOMPLETE — needs benchmark return and Sharpe ratio to judge a higher-fee fund';
    if (c.excessReturn5y > 0 && f.sharpeRatio >= 0.7) return 'ACCEPTABLE active — alpha after fees';
    return 'AVOID — fees without alpha / poor risk-adjusted';
  })();
  return c;
}

function computeBonds(b) {
  const c = { why: {} }; const need = makeNeed(b);
  const calc = (k, fields, fn) => { const r = need(fields); if (r) { c[k] = null; c.why[k] = r; return; } const v = fn(); c[k] = ok(v) ? v : null; if (!ok(v)) c.why[k] = 'not computable'; };
  const isFund = b.bondType === 'Bond ETF';
  if (isFund) { // per-bond par/coupon math doesn't apply to a fund share price
    c.currentYield = ok(b.distributionYield) ? b.distributionYield : null; c.why.currentYield = 'needs distribution yield';
    c.approxYTM = null; c.why.approxYTM = "not applicable to a fund — use the fund's published YTM / SEC yield";
  } else {
    calc('currentYield', ['couponRate', 'parValue', 'price'], () => (b.couponRate * b.parValue) / b.price);
    calc('approxYTM', ['couponRate', 'parValue', 'price', 'yearsToMaturity'], () => ((b.couponRate * b.parValue) + (b.parValue - b.price) / b.yearsToMaturity) / ((b.parValue + b.price) / 2));
  }
  calc('taxEquivalentYield', ['ytw', 'marginalTaxRate'], () => b.ytw / (1 - b.marginalTaxRate));
  calc('realYield', ['ytw', 'inflationAssumption'], () => (1 + b.ytw) / (1 + b.inflationAssumption) - 1);
  calc('creditSpread', ['ytm', 'comparableTreasuryYield'], () => b.ytm - b.comparableTreasuryYield);
  calc('expectedLoss', ['defaultProbability', 'recoveryRate'], () => b.defaultProbability * (1 - b.recoveryRate));
  calc('expectedReturnAdj', ['ytw', 'defaultProbability', 'recoveryRate'], () => b.ytw - c.expectedLoss);
  calc('durationImpact', ['modDuration'], () => -b.modDuration * 0.01);
  c.verdict = (() => {
    if (!ok(c.creditSpread) || !ok(c.realYield)) return `INCOMPLETE — enter ${[!ok(b.ytm) && 'YTM', !ok(b.ytw) && 'YTW'].filter(Boolean).join(' and ') || 'missing yields'} (not available from free sources)`;
    if (c.creditSpread >= 0.005 && c.realYield > 0 && b.ytm >= b.comparableTreasuryYield) return 'ATTRACTIVE — yield compensates credit/duration risk, real yield positive';
    if (c.realYield <= 0) return 'AVOID — negative real yield';
    if (c.creditSpread < 0.002) return 'AVOID — spread too thin for risk';
    return 'WATCH — mixed';
  })();
  return c;
}

function computePortfolioFit(p) {
  const c = {};
  c.positionWithinLimit = p.intendedPositionSize <= p.maxPositionSize;
  c.horizonOk = p.timeHorizon > p.liquidityNeed;
  c.convictionOk = p.conviction >= 3;
  // FIX (kept): the workbook compared against the literal "FAIL", which never matched its own "FAIL — …" strings.
  c.verdict = (() => {
    if (c.positionWithinLimit && c.horizonOk && c.convictionOk) return 'FITS portfolio — proceed';
    if (!c.positionWithinLimit) return 'AVOID — exceeds position limit';
    if (!c.horizonOk) return 'AVOID — horizon too short';
    return 'WAIT — raise conviction';
  })();
  return c;
}

function computeSummaryBottomLine(val) {
  if (val.verdict.startsWith('INCOMPLETE')) return 'Not enough data for a verdict — see "Data gaps" above and fill the missing inputs on the Inputs & Sources tab.';
  if (ok(val.ownerEarnings) && val.ownerEarnings < 0) return 'This company loses money on an owner-earnings basis — avoid regardless of price.';
  if (val.verdict.startsWith('OVERVALUED')) return 'Price is above intrinsic value across most methods — wait for a pullback or skip.';
  if (val.verdict.startsWith('WATCH')) return 'Fairly valued / mixed signals — not a clear bargain. Re-check growth and margin-of-safety assumptions.';
  if (val.verdict.startsWith('UNDERVALUED')) return 'Meets value criteria with a margin of safety — a candidate to buy if it fits your portfolio.';
  return 'See the detailed verdict above.';
}

/* ============================================================================
   PART 4a — SEC XBRL EXTRACTION (pure functions; tested against real filings)
   ============================================================================ */
