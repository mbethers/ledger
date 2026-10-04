// XBRL us-gaap aliases, highest priority first. Aliases are MERGED per period (a company that
// switched tags mid-history still gets one continuous series), never "first tag that exists wins".
const XBRL_TAGS = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'SalesRevenueServicesNet', 'RevenuesNetOfInterestExpense'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices'],
  grossProfit: ['GrossProfit'],
  ebit: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization', 'DepreciationDepletionAndAmortizationExcludingAmortizationOfDeferredCharges', 'Depreciation'],
  interestExpense: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'InterestAndDebtExpense', 'InterestExpenseNet'],
  epsDiluted: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
  dividendsPaid: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends', 'PaymentsOfOrdinaryDividends'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'],
  shortTermInvestments: ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent', 'AvailableForSaleSecuritiesCurrent', 'OtherShortTermInvestments'],
  totalCurrentAssets: ['AssetsCurrent'],
  totalAssets: ['Assets'],
  totalCurrentLiabilities: ['LiabilitiesCurrent'],
  longTermDebtNoncurrent: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermDebtAndFinanceLeaseObligationsNoncurrent' , 'LongTermNotesPayable', 'SeniorLongTermNotes', 'ConvertibleNotesPayableNoncurrent'],
  longTermDebtCurrent: ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'DebtCurrent'],
  longTermDebtTotal: ['LongTermDebt'],
  shortTermBorrowings: ['ShortTermBorrowings', 'CommercialPaper', 'ShortTermBankLoansAndNotesPayable'],
  totalLiabilities: ['Liabilities'],
  liabilitiesAndEquity: ['LiabilitiesAndStockholdersEquity'],
  goodwill: ['Goodwill'],
  intangibles: ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet'],
  totalEquity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  equityInclNCI: ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'StockholdersEquity'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'],
  sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'],
  pretaxIncome: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic'],
  incomeTaxExpense: ['IncomeTaxExpenseBenefit'],
};

// Pure: SEC companyfacts JSON → { values, source, why, warnings }.
//   values[f]  number, or null when it genuinely couldn't be determined
//   source[f]  human-readable provenance for the audit trail
//   why[f]     reason a field is null (shown in the UI instead of a blank or a fake 0)
const fmtBig = (n) => `$${(n / 1e9).toFixed(2)}B`;
function buildFundamentals(facts, todayISO) {
  const v = {}, source = {}, why = {}, warnings = [];
  const today = todayISO || new Date().toISOString().slice(0, 10);
  XBRL.detectSplits(facts);
  for (const s of XBRL.splits) warnings.push(`Detected a ${s.factor >= 1 ? `${+s.factor.toFixed(2)}-for-1 stock split` : `1-for-${+(1 / s.factor).toFixed(2)} reverse split`} (between filings of ${s.before} and ${s.after}); older per-share figures were rescaled to today's share basis.`);
  const lbl = (r) => (r.basis === 'TTM' ? `TTM to ${r.end}` : `FY ending ${r.end}`);
  const tagName = (t) => `us-gaap:${t}`;

  // ---- flow (income / cash-flow) items: TTM where 10-Qs allow, else latest fiscal year ----
  const flows = {};
  const flowFields = ['revenue', 'costOfRevenue', 'grossProfit', 'ebit', 'netIncome', 'da', 'interestExpense', 'dividendsPaid',
    'operatingCashFlow', 'capex', 'sbc', 'pretaxIncome', 'incomeTaxExpense'];
  for (const f of flowFields) flows[f] = XBRL.ttm(facts, XBRL_TAGS[f]);
  flows.epsDiluted = XBRL.ttm(facts, XBRL_TAGS.epsDiluted, { unit: 'USD/shares' });
  flows.dilutedShares = XBRL.ttm(facts, XBRL_TAGS.dilutedShares, { unit: 'shares' }); // used only for its annual series

  const refEnd = (flows.netIncome || flows.epsDiluted || flows.revenue)?.end;
  const setFlow = (field, r, label) => {
    if (!r) { v[field] = null; why[field] = `no ${label} tag found in this company's XBRL filings`; return; }
    if (refEnd && dDays(refEnd, r.end) > 400) { v[field] = null; why[field] = `${label} last reported for the period ending ${r.end} (company stopped tagging it) — too stale to pair with ${refEnd} figures`; return; }
    v[field] = r.val; source[field] = `SEC EDGAR · ${tagName(r.tag)} · ${lbl(r)}`;
    if (refEnd && dDays(refEnd, r.end) > 200) { source[field] += ' ⚠ older period than other fields'; warnings.push(`${label} is only available through ${r.end}, older than the other income figures (${refEnd}).`); }
  };
  setFlow('revenue', flows.revenue, 'revenue');
  setFlow('netIncome', flows.netIncome, 'net income');
  setFlow('epsTTM', flows.epsDiluted, 'diluted EPS');
  setFlow('da', flows.da, 'depreciation & amortization');
  setFlow('operatingCashFlow', flows.operatingCashFlow, 'operating cash flow');
  setFlow('capex', flows.capex, 'capital expenditures');

  // Gross profit: reported, else revenue − cost of revenue for the SAME period.
  if (flows.grossProfit && (!flows.revenue || flows.grossProfit.end === flows.revenue.end)) setFlow('grossProfit', flows.grossProfit, 'gross profit');
  else if (flows.revenue && flows.costOfRevenue && flows.revenue.end === flows.costOfRevenue.end) {
    v.grossProfit = flows.revenue.val - flows.costOfRevenue.val; source.grossProfit = `SEC EDGAR · derived: revenue − ${tagName(flows.costOfRevenue.tag)} · ${lbl(flows.revenue)}`;
  } else { v.grossProfit = null; why.grossProfit = 'no gross-profit or cost-of-revenue tag for the same period (common for banks, insurers, and service firms)'; }

  // Interest expense: zero is a real answer for debt-free companies, so a missing tag stays null (shown as "not reported").
  setFlow('interestExpense', flows.interestExpense, 'interest expense');

  // EBIT: reported operating income, else pre-tax income + interest expense.
  if (flows.ebit) setFlow('ebit', flows.ebit, 'operating income');
  else if (flows.pretaxIncome && flows.pretaxIncome.end === refEnd) {
    const ie = (flows.interestExpense && flows.interestExpense.end === flows.pretaxIncome.end) ? flows.interestExpense.val : 0;
    v.ebit = flows.pretaxIncome.val + ie;
    source.ebit = `SEC EDGAR · derived: pre-tax income${flows.interestExpense ? ' + interest expense' : ' (no interest expense tag)'} · ${lbl(flows.pretaxIncome)}`;
  } else { v.ebit = null; why.ebit = 'no operating-income or pre-tax-income tag found'; }

  // Dividends: absence of any dividend tag almost always means none were paid.
  if (flows.dividendsPaid) {
    setFlow('dividendsPaid', flows.dividendsPaid, 'dividends paid');
    if (refEnd && dDays(refEnd, flows.dividendsPaid.end) > 400) { v.dividendsPaid = 0; source.dividendsPaid = `SEC EDGAR · no dividend payments reported since ${flows.dividendsPaid.end} → 0`; }
  } else { v.dividendsPaid = 0; source.dividendsPaid = 'SEC EDGAR · no dividend-payment tags in filings → treated as 0 (verify)'; }
  setFlow('sbc', flows.sbc, 'share-based compensation');

  // ---- balance sheet: everything aligned to the SAME, most recent balance-sheet date ----
  const anchor = XBRL.latestInstant(facts, XBRL_TAGS.totalAssets) || XBRL.latestInstant(facts, XBRL_TAGS.liabilitiesAndEquity);
  const bsDate = anchor?.end;
  const bs = (field, tags, label, { zeroIfMissing = false } = {}) => {
    if (!bsDate) { v[field] = null; why[field] = 'no balance sheet found in XBRL filings'; return null; }
    const p = XBRL.instantAt(facts, tags, bsDate);
    if (p) { v[field] = p.val; source[field] = `SEC EDGAR · ${tagName(p.tag)} · as of ${bsDate} (${p.form})`; return p; }
    if (zeroIfMissing) { v[field] = 0; source[field] = `SEC EDGAR · not reported on the ${bsDate} balance sheet → 0 (verify)`; return null; }
    const stale = XBRL.latestInstant(facts, tags);
    if (stale && dDays(bsDate, stale.end) < 400) { v[field] = stale.val; source[field] = `SEC EDGAR · ${tagName(stale.tag)} · as of ${stale.end} ⚠ older than ${bsDate}`; return stale; }
    v[field] = null; why[field] = `${label} not reported on the ${bsDate} balance sheet`; return null;
  };
  bs('cash', XBRL_TAGS.cash, 'cash & equivalents');
  bs('shortTermInvestments', XBRL_TAGS.shortTermInvestments, 'short-term investments', { zeroIfMissing: true });
  bs('totalCurrentAssets', XBRL_TAGS.totalCurrentAssets, 'total current assets');
  bs('totalAssets', XBRL_TAGS.totalAssets, 'total assets');
  bs('totalCurrentLiabilities', XBRL_TAGS.totalCurrentLiabilities, 'total current liabilities');
  bs('goodwill', XBRL_TAGS.goodwill, 'goodwill', { zeroIfMissing: true });
  bs('intangibles', XBRL_TAGS.intangibles, 'intangibles', { zeroIfMissing: true });
  bs('totalEquity', XBRL_TAGS.totalEquity, "shareholders' equity");

  // Total liabilities: reported, else (liabilities + equity) − equity incl. minority interest.
  const tl = bsDate && XBRL.instantAt(facts, XBRL_TAGS.totalLiabilities, bsDate);
  if (tl) { v.totalLiabilities = tl.val; source.totalLiabilities = `SEC EDGAR · ${tagName(tl.tag)} · as of ${bsDate}`; }
  else {
    const le = bsDate && XBRL.instantAt(facts, XBRL_TAGS.liabilitiesAndEquity, bsDate);
    const eq = bsDate && XBRL.instantAt(facts, XBRL_TAGS.equityInclNCI, bsDate);
    if (le && eq) { v.totalLiabilities = le.val - eq.val; source.totalLiabilities = `SEC EDGAR · derived: LiabilitiesAndStockholdersEquity − ${eq.tag} · as of ${bsDate}`; }
    else { v.totalLiabilities = null; why.totalLiabilities = 'total liabilities not reported and could not be derived'; }
  }

  // Total debt = long-term debt (incl. current portion) + short-term borrowings/commercial paper.
  if (bsDate) {
    const parts = [];
    const ltTotal = XBRL.instantAt(facts, XBRL_TAGS.longTermDebtTotal, bsDate);
    const ltNon = XBRL.instantAt(facts, XBRL_TAGS.longTermDebtNoncurrent, bsDate);
    const ltCur = XBRL.instantAt(facts, XBRL_TAGS.longTermDebtCurrent, bsDate);
    if (ltTotal && (!ltNon || ltTotal.val >= ltNon.val)) parts.push(ltTotal);
    else { if (ltNon) parts.push(ltNon); if (ltCur) parts.push(ltCur); }
    for (const t of XBRL_TAGS.shortTermBorrowings) { const p = XBRL.instantAt(facts, [t], bsDate); if (p) parts.push(p); }
    v.longTermDebt = ltNon ? ltNon.val : (ltTotal ? ltTotal.val - (ltCur?.val || 0) : 0);
    source.longTermDebt = ltNon ? `SEC EDGAR · ${tagName(ltNon.tag)} · as of ${bsDate}` : ltTotal ? `SEC EDGAR · derived from ${tagName(ltTotal.tag)} · as of ${bsDate}` : `SEC EDGAR · no long-term debt reported on the ${bsDate} balance sheet → 0 (verify)`;
    v.totalDebt = parts.reduce((s, p) => s + p.val, 0);
    source.totalDebt = parts.length ? `SEC EDGAR · ${parts.map(p => p.tag).join(' + ')} · as of ${bsDate}` : `SEC EDGAR · no debt tags on the ${bsDate} balance sheet → 0 (verify)`;
    // No recognised debt tags, yet material interest expense → the company tags its debt in a way
    // we don't map (e.g. Berkshire). Reporting 0 here would look legitimate and be wrong.
    if (!parts.length && flows.interestExpense && flows.interestExpense.val > 0 && (!refEnd || dDays(refEnd, flows.interestExpense.end) <= 400)) {
      v.totalDebt = null; delete source.totalDebt;
      why.totalDebt = `no standard debt tags on the ${bsDate} balance sheet, yet ${fmtBig(flows.interestExpense.val)} of interest expense is reported — debt exists but is tagged in a way this tool doesn't recognize; enter it from the 10-K/10-Q`;
      if (!ltNon && !ltTotal) { v.longTermDebt = null; delete source.longTermDebt; why.longTermDebt = why.totalDebt; }
    }
  } else { v.longTermDebt = v.totalDebt = null; why.longTermDebt = why.totalDebt = 'no balance sheet found'; }

  // ---- shares: cover-page shares outstanding (most current), else weighted-average diluted ----
  const dei = XBRL.latestInstant(facts, ['EntityCommonStockSharesOutstanding'], { unit: 'shares', taxonomy: 'dei' });
  const wad = XBRL.ttm(facts, XBRL_TAGS.dilutedShares, { unit: 'shares' });
  const wadLatest = (() => { // latest weighted-average diluted count from any filing (quarterly included)
    let best = null; for (const p of XBRL.tagPoints(facts, XBRL_TAGS.dilutedShares, 'shares')) if (p.start && (!best || p.end > best.end)) best = p; return best;
  })();
  if (dei && (!wadLatest || (dei.val > 0.85 * wadLatest.val && dei.val < 1.2 * wadLatest.val)) && dDays(today, dei.end) < 500) {
    v.dilutedShares = dei.val; source.dilutedShares = `SEC EDGAR · dei:EntityCommonStockSharesOutstanding · as of ${dei.end} (${dei.form} cover page)`;
  } else if (wadLatest) {
    v.dilutedShares = wadLatest.val; source.dilutedShares = `SEC EDGAR · ${tagName(wadLatest.tag)} (weighted-avg diluted) · period ending ${wadLatest.end}`;
    if (dei) warnings.push(`Cover-page share count (${Math.round(dei.val).toLocaleString()}) doesn't match diluted weighted shares (${Math.round(wadLatest.val).toLocaleString()}) — possibly multiple share classes. Using diluted weighted shares; verify market cap.`);
  } else { v.dilutedShares = null; why.dilutedShares = 'no share-count tag found'; }

  // ---- multi-year derived figures (annual series keyed by period end) ----
  const revS = flows.revenue?.series, niS = flows.netIncome?.series, epsS = flows.epsDiluted?.series;
  const eqS = XBRL.annual(facts, XBRL_TAGS.totalEquity, { instant: true });
  const setDerived = (field, r, srcText) => { v[field] = r.val; if (r.val == null) { why[field] = r.why; if (r.neg) v[field + 'Neg'] = true; } else source[field] = srcText(r); };
  setDerived('revCAGR5', XBRL.cagr(revS, 5), r => `SEC EDGAR · revenue CAGR, FY ${r.from} → ${r.to}`);
  const epsSeries = (epsS && epsS.length >= 2) ? epsS : null;
  setDerived('epsCAGR5', epsSeries ? XBRL.cagr(epsSeries, 5) : { val: null, why: 'no multi-year diluted EPS series' }, r => `SEC EDGAR · diluted EPS CAGR, FY ${r.from} → ${r.to}`);
  setDerived('epsCAGR10', epsSeries ? XBRL.cagr(epsSeries, 10) : { val: null, why: 'no multi-year diluted EPS series' }, r => `SEC EDGAR · diluted EPS CAGR, FY ${r.from} → ${r.to}`);

  const ocfS = flows.operatingCashFlow?.series, capS = flows.capex?.series;
  if (ocfS && capS) {
    const fcfS = ocfS.map(o => { const c = capS.find(cc => cc.end === o.end); return c ? { end: o.end, val: o.val - c.val } : null; }).filter(Boolean);
    setDerived('fcfCAGR5', XBRL.cagr(fcfS, 5), r => `SEC EDGAR · (OCF − capex) CAGR, FY ${r.from} → ${r.to}`);
  } else { v.fcfCAGR5 = null; why.fcfCAGR5 = 'operating cash flow or capex history missing'; }

  if (niS && niS.length) {
    const last10 = niS.slice(-10);
    v.yearsPositiveEarnings = last10.filter(p => p.val > 0).length; v.yearsPositiveEarningsOf = last10.length;
    source.yearsPositiveEarnings = `SEC EDGAR · ${v.yearsPositiveEarnings} of last ${last10.length} fiscal years (FY ${last10[0].end} → ${last10[last10.length - 1].end}) with net income > 0`;
  } else { v.yearsPositiveEarnings = null; why.yearsPositiveEarnings = 'no annual net-income history'; }

  const divS = XBRL.annual(facts, XBRL_TAGS.dividendsPaid);
  const niYears = niS ? niS.slice(-20) : [];
  if (niYears.length) {
    // Count fiscal years (on the net-income calendar) in which a dividend payment was reported.
    const paid = niYears.filter(n => divS.some(d => d.end === n.end && d.val > 0)).length;
    v.yearsDividends = paid; v.yearsDividendsOf = niYears.length;
    source.yearsDividends = `SEC EDGAR · dividends paid in ${paid} of ${niYears.length} fiscal years with XBRL data (FY ${niYears[0].end} → ${niYears[niYears.length - 1].end})`;
    if (niYears.length < 20) v.yearsDividendsNote = `SEC XBRL data only reaches back to FY ${niYears[0].end}, so at most ${niYears.length} years can be verified here.`;
  } else { v.yearsDividends = null; why.yearsDividends = 'no annual history to count'; }

  if (niS && eqS.length) {
    const roes = niS.map(n => { const e = eqS.find(q => q.end === n.end); return (e && e.val > 0) ? { end: n.end, val: n.val / e.val } : null; }).filter(Boolean).slice(-5);
    if (roes.length) { v.avgROE = roes.reduce((s, r) => s + r.val, 0) / roes.length; source.avgROE = `SEC EDGAR · mean of net income ÷ year-end equity over ${roes.length} FY (${roes[0].end} → ${roes[roes.length - 1].end})`; }
    else { v.avgROE = null; why.avgROE = 'equity was ≤ 0 or unmatched in every year — ROE not meaningful'; }
  } else { v.avgROE = null; why.avgROE = 'net income or equity history missing'; }

  if (v.ebit != null && v.totalEquity != null) {
    const pt = flows.pretaxIncome, tx = flows.incomeTaxExpense;
    const taxRate = (pt && tx && pt.val > 0 && pt.end === tx.end) ? Math.min(0.5, Math.max(0, tx.val / pt.val)) : 0.21;
    const ic = (v.totalDebt || 0) + v.totalEquity - (v.cash || 0);
    if (ic > 0) { v.avgROIC = v.ebit * (1 - taxRate) / ic; source.avgROIC = `derived: EBIT × (1 − ${(taxRate * 100).toFixed(1)}% tax) ÷ (debt + equity − cash), latest period only`; }
    else { v.avgROIC = null; why.avgROIC = 'invested capital (debt + equity − cash) is ≤ 0 — ROIC not meaningful'; }
  } else { v.avgROIC = null; why.avgROIC = 'needs EBIT and equity'; }

  if (revS) {
    const gpS = XBRL.annual(facts, XBRL_TAGS.grossProfit), corS = XBRL.annual(facts, XBRL_TAGS.costOfRevenue);
    const margins = revS.map(r => {
      const g = gpS.find(x => x.end === r.end), c = corS.find(x => x.end === r.end);
      const gp = g ? g.val : c ? r.val - c.val : null;
      return (gp != null && r.val > 0) ? gp / r.val : null;
    }).filter(x => x != null).slice(-5);
    if (margins.length >= 2) { const m = margins.reduce((a, b) => a + b, 0) / margins.length; v.grossMarginStdDev = Math.sqrt(margins.reduce((s, x) => s + (x - m) ** 2, 0) / (margins.length - 1)); source.grossMarginStdDev = `SEC EDGAR · std dev of gross margin over ${margins.length} FY`; }
    else { v.grossMarginStdDev = null; why.grossMarginStdDev = 'fewer than 2 years of gross-margin data (no gross profit / cost of revenue reported)'; }
  } else { v.grossMarginStdDev = null; why.grossMarginStdDev = 'no revenue history'; }

  if (v.totalDebt != null && v.totalEquity != null && v.totalEquity > 0) { v.debtEquity = v.totalDebt / v.totalEquity; source.debtEquity = `derived: total debt ÷ equity as of ${bsDate}`; }
  else { v.debtEquity = null; why.debtEquity = v.totalEquity != null && v.totalEquity <= 0 ? "shareholders' equity is ≤ 0 — D/E not meaningful" : 'needs total debt and equity'; }

  // ---- year-by-year history for the Financials tab (annual 10-K values keyed by fiscal year-end) ----
  {
    const rows = new Map();
    const add = (series, key) => { for (const p of series || []) { const r = rows.get(p.end) || { end: p.end }; r[key] = p.val; rows.set(p.end, r); } };
    add(revS, 'revenue'); add(XBRL.annual(facts, XBRL_TAGS.grossProfit), 'grossProfit'); add(XBRL.annual(facts, XBRL_TAGS.costOfRevenue), 'costOfRevenue');
    add(XBRL.annual(facts, XBRL_TAGS.ebit), 'ebit'); add(XBRL.annual(facts, XBRL_TAGS.pretaxIncome), 'pretax'); add(XBRL.annual(facts, XBRL_TAGS.interestExpense), 'interest');
    add(niS, 'netIncome'); add(epsS, 'eps'); add(ocfS, 'ocf'); add(capS, 'capex'); add(eqS, 'equity'); add(divS, 'dividends');
    const hist = [...rows.values()].filter(r => r.revenue != null || r.netIncome != null).sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 10).map(r => {
      const o = { ...r };
      if (o.grossProfit == null && o.revenue != null && o.costOfRevenue != null) { o.grossProfit = o.revenue - o.costOfRevenue; o.grossProfitDerived = true; }
      if (o.ebit == null && o.pretax != null) { o.ebit = o.pretax + (o.interest || 0); o.ebitDerived = true; }
      o.fcf = o.ocf != null && o.capex != null ? o.ocf - o.capex : null;
      o.roe = o.netIncome != null && o.equity > 0 ? o.netIncome / o.equity : null;
      return o;
    });
    // Lead with the trailing-twelve-months row when 10-Qs make one available.
    if (flows.netIncome?.basis === 'TTM' || flows.revenue?.basis === 'TTM') {
      hist.unshift({ end: refEnd, ttm: true, revenue: v.revenue, grossProfit: v.grossProfit, ebit: v.ebit, ebitDerived: !flows.ebit, netIncome: v.netIncome, eps: v.epsTTM,
        ocf: v.operatingCashFlow, capex: v.capex, fcf: v.operatingCashFlow != null && v.capex != null ? v.operatingCashFlow - v.capex : null,
        equity: v.totalEquity, roe: v.netIncome != null && v.totalEquity > 0 ? v.netIncome / v.totalEquity : null, dividends: v.dividendsPaid });
    }
    v.history = hist;
  }

  // Staleness: a company that stopped filing (or switched to tags we don't map) shows up here.
  if (refEnd && dDays(today, refEnd) > 450) warnings.push(`Most recent income data in SEC XBRL is for the period ending ${refEnd} — over a year old. The company may have stopped filing or been acquired.`);
  if (bsDate && dDays(today, bsDate) > 450) warnings.push(`Most recent balance sheet in SEC XBRL is dated ${bsDate} — over a year old.`);
  v.periodEnd = refEnd || null; v.balanceSheetDate = bsDate || null;
  v.epsBasis = flows.epsDiluted ? lbl(flows.epsDiluted) : null;
  return { values: v, source, why, warnings };
}

if (typeof module !== 'undefined') module.exports = { buildFundamentals, XBRL_TAGS };
