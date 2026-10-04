
/* ============================================================================
   PART 6 — RENDER: shared helpers + Summary / Valuation / Graham / Buffett / Lynch
   ============================================================================ */

const TABS_BY_TYPE = {
  stock: [['summary', 'Summary', null], ['valuation', 'Valuation', null], ['financials', 'Financials', null], ['graham', 'Graham', 'g'], ['buffett', 'Buffett', 'b'], ['lynch', 'Lynch', 'l'], ['portfolio', 'Portfolio Fit', null], ['sources', 'Inputs & Sources', null]],
  fund: [['summary', 'Summary', null], ['funds', 'Fund / ETF Detail', null], ['portfolio', 'Portfolio Fit', null], ['sources', 'Inputs & Sources', null]],
  bond: [['summary', 'Summary', null], ['bonds', 'Bond Detail', null], ['portfolio', 'Portfolio Fit', null], ['sources', 'Inputs & Sources', null]],
};

const SRC_LABEL = { fetched: 'Auto-filled from live data', default: 'Neutral / seeded default — confirm before relying on it', manual: 'Typed in manually', missing: 'Could not be fetched — enter it yourself' };
function srcDot(group, field) {
  const s = (AppState.fieldSource[group] || {})[field] || 'manual';
  const detail = (AppState.sourceDetail[group] || {})[field];
  const w = AppState[group]?.__why?.[field];
  return `<span class="src-dot ${s}" title="${esc(SRC_LABEL[s] + (s === 'missing' && w ? ` — ${w}` : detail ? ` — ${detail}` : ''))}"></span>`;
}
function missHint(group, field) {
  const s = (AppState.fieldSource[group] || {})[field];
  const w = AppState[group]?.__why?.[field];
  return s === 'missing' && w ? `<span class="hint miss">Not fetched: ${esc(w)}</span>` : '';
}

function efield(group, field, value, opts = {}) {
  const { type = 'number', step = 'any', options = null, transform = null, wide = false } = opts;
  const dt = transform ? ` data-transform="${transform}"` : '';
  if (type === 'select') return `<select class="efield" data-group="${group}" data-field="${field}">${options.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  if (type === 'text') return `<input class="efield ${wide ? 'wide' : ''}" type="text" data-group="${group}" data-field="${field}"${dt} value="${esc(value)}">`;
  if (type === 'textarea') return `<textarea class="efield" data-group="${group}" data-field="${field}">${esc(value)}</textarea>`;
  const isMissing = (AppState.fieldSource[group] || {})[field] === 'missing';
  const displayVal = !ok(value) ? '' : transform === 'pct' ? +(value * 100).toFixed(4) : value;
  return `<input class="efield${isMissing ? ' is-missing' : ''}" type="number" step="${step}" data-group="${group}" data-field="${field}"${dt} value="${displayVal}" placeholder="${isMissing ? 'missing' : ''}">`;
}

function verdictClass(v) {
  if (/^INCOMPLETE/.test(v)) return 'incomplete';
  if (/UNDERVALUED|ATTRACTIVE|FAVORABLE|FITS|ACCEPTABLE/.test(v)) return 'undervalued';
  if (/OVERVALUED|AVOID/.test(v)) return 'overvalued';
  return 'watch';
}
function pillClass(signal) {
  if (signal === 'Undervalued' || signal === 'PASS') return 'good';
  if (signal === 'Overvalued' || signal === 'FAIL') return 'bad';
  if (signal === 'Fair' || signal === 'UNVERIFIED') return 'watch';
  return 'na';
}
function pill(text) { return `<span class="pill ${pillClass(text)}">${esc(text)}</span>`; }

function barRow(label, intrinsic, price, why) {
  if (!ok(intrinsic)) return `<div class="barchart-row"><span class="barchart-label">${label}</span><div class="barchart-track empty">${esc(why || 'unavailable')}</div><span class="barchart-val" style="color:var(--ink-faint)">n/a</span></div>`;
  const p = ok(price) ? price : 0;
  const max = Math.max(intrinsic, p) * 1.15;
  const good = !ok(price) || intrinsic >= price;
  return `<div class="barchart-row">
    <span class="barchart-label">${label}</span>
    <div class="barchart-track">
      <div class="barchart-fill ${good ? 'good' : 'bad'}" style="width:${Math.max(2, (intrinsic / max) * 100)}%"></div>
      ${ok(price) ? `<div class="barchart-marker" style="left:${(price / max) * 100}%" title="Current price"></div>` : ''}
    </div>
    <span class="barchart-val">${fmt.price(intrinsic)}</span>
  </div>`;
}

function verdictStampBlock(verdict, confidence, bottomLine, metaLine = '') {
  const label = verdict.split('—')[0].trim();
  return `<div class="verdict-wrap">
    <div class="verdict-stamp ${verdictClass(verdict)}">${esc(label)}</div>
    <div class="verdict-meta">
      ${ok(confidence) ? `<div class="vm-conf">Confidence <b>${confidence}</b>/100${metaLine}</div><div class="conf-bar"><div class="conf-bar-fill" style="width:${Math.max(4, confidence)}%"></div></div>` : metaLine ? `<div class="vm-conf">${metaLine}</div>` : ''}
      <p class="verdict-bottomline">${esc(verdict.includes('—') ? verdict.split('—').slice(1).join('—').trim() + '. ' : '')}${esc(bottomLine)}</p>
    </div>
  </div>`;
}

// Lists every input that couldn't be fetched, with the reason — the antidote to a
// "plausible-looking but partially empty" report.
function dataGapsPanel(group, fieldsOfInterest) {
  const src = AppState.fieldSource[group] || {}; const inp = AppState[group];
  const missing = (fieldsOfInterest || Object.keys(src)).filter(f => src[f] === 'missing');
  const warns = AppState.warnings || [];
  if (!missing.length && !warns.length) return '';
  return `<div class="card gap-panel ${missing.length ? '' : 'minor'}">
    <div class="card-head"><h3>Data gaps &amp; warnings</h3><span class="card-note">${missing.length} input${missing.length === 1 ? '' : 's'} missing · fill them on Inputs &amp; Sources</span></div>
    <div class="card-body"><ul class="gap-list">
      ${missing.map(f => `<li><b>${esc(FIELD_LABEL[f] || f)}</b> — not available<span class="gap-why">${esc(inp.__why?.[f] || 'no reason recorded')}</span></li>`).join('')}
      ${warns.map(w => `<li>⚠ ${esc(w)}</li>`).join('')}
    </ul></div>
  </div>`;
}

function reportHead(name, sub) {
  return `<div class="report-head"><h2>${esc(AppState.ticker)}${name ? ` · ${esc(name)}` : ''}</h2><span class="kv-inline">${sub || ''}</span></div>`;
}

function renderApp() {
  if (!AppState.ticker) return;
  const content = document.getElementById('tabContent');
  const nav = document.getElementById('tabNav');
  const data = AppState[AppState.assetType];
  if (!data) { nav.innerHTML = ''; content.innerHTML = `<div class="empty-tab"><h3>No data for ${esc(AppState.ticker)}</h3><p>The analysis didn't complete — see the fetch log above.</p></div>`; return; }
  const tabs = TABS_BY_TYPE[AppState.assetType];
  if (!tabs.some(t => t[0] === AppState.activeTab)) AppState.activeTab = 'summary';
  nav.innerHTML = tabs.map(([id, label, tag]) => `<button type="button" class="tab-btn ${AppState.activeTab === id ? 'is-active' : ''}" data-tab="${id}">${tag ? `<span class="tag" style="background:var(--${tag === 'g' ? 'graham' : tag === 'b' ? 'buffett' : 'lynch'})"></span>` : ''}${label}</button>`).join('');
  const renderers = {
    summary: AppState.assetType === 'stock' ? renderSummaryStock : AppState.assetType === 'fund' ? renderSummaryFund : renderSummaryBond,
    valuation: renderValuation, financials: renderFinancials, graham: renderGraham, buffett: renderBuffett, lynch: renderLynch,
    funds: renderFunds, bonds: renderBonds, portfolio: renderPortfolio, sources: renderSources,
  };
  const scrollY = window.scrollY;
  let html;
  try { html = (renderers[AppState.activeTab] || renderers.summary)(); }
  catch (e) { console.error(e); html = `<div class="note-box warn">Rendering error on this tab: ${esc(e.message)}. Your inputs are intact — please report this.</div>`; }
  content.innerHTML = `<div class="tab-pane is-active">${html}</div>`;
  try { mountPriceChart(); } catch (e) { console.error(e); }
  window.scrollTo(0, scrollY);
}

function setActiveTab(id) { AppState.activeTab = id; renderApp(); }
function setAnalyzing(v) { const b = document.getElementById('analyzeBtn'); b.disabled = v; b.textContent = v ? 'Analyzing…' : 'Analyze'; }

function renderFetchStatus() {
  const el = document.getElementById('fetchStatus');
  if (!el || el.hidden) return;
  const icon = { ok: '✓', warn: '⚠', err: '✗', info: '·' };
  const line = (l) => `<div class="fs-line"><span class="fs-icon fs-${l.level}">${icon[l.level]}</span><span>${esc(l.text)}</span></div>`;
  // Once an analysis finishes, collapse to its final line so the sticky header doesn't cover the report.
  if (AppState.logCollapsed && !AppState.busy && Fetcher.log.length > 1) {
    el.innerHTML = line(Fetcher.log[Fetcher.log.length - 1]) + `<button type="button" class="fs-toggle" data-action="expand-log">show full log (${Fetcher.log.length} lines)</button>`;
    return;
  }
  el.innerHTML = Fetcher.log.map(line).join('')
    + (Fetcher.log.length && !AppState.busy ? `<button type="button" class="fs-toggle" data-action="${Fetcher.log.length > 1 ? 'collapse-log' : 'hide-log'}">${Fetcher.log.length > 1 ? 'collapse log' : 'hide'}</button>` : '');
}

function renderWatchlist() {
  const el = document.getElementById('watchlistStrip');
  if (!AppState.watchlist?.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<span>Recent:</span>` + AppState.watchlist.map(w => `<button type="button" class="wl-chip ${w.ticker === AppState.ticker ? 'is-current' : ''}" data-wl="${esc(w.ticker)}" data-wat="${esc(w.assetType)}" title="Open saved analysis (click Analyze to refresh live data)">${esc(w.ticker)}</button>`).join('');
}

const sum = (inp) => { const v = computeValuation(inp); return { val: v, gc: computeGrahamChecklist(inp, v), bc: computeBuffettChecklist(inp, v), lc: computeLynchChecklist({ ...inp, ...AppState.lynch }, v) }; };

// Shown when reported earnings lean on one-off, non-operating items or aren't backed by cash.
function earningsQualityPanel(inp) {
  const eq = inp.earningsQuality; if (!eq) return '';
  const canSwitch = canUseEarningsBasis(inp, 'core');
  const p = (html) => `<p style="margin-top:10px; font-size:13px; color:var(--ink-dim)">${html}</p>`;
  const action = !canSwitch ? '' : inp.coreEarningsApplied
    ? p(`Valuing on <b>core earnings</b>: EPS ${fmt.price(eq.coreEPS)} (reported ${fmt.price(eq.reportedEPS)}). <button type="button" class="btn sm" data-action="reported-earnings">Switch back to reported earnings</button>`)
    : inp.normalizedEarningsApplied
      ? p(`The verdict below uses normalized earnings (see the cyclical panel), which are built from operating margin and so already exclude non-operating income. <button type="button" class="btn sm" data-action="core-earnings">Use core earnings instead (EPS ≈ ${fmt.price(eq.coreEPS)})</button>`)
      : p(`The verdict below uses reported EPS of ${fmt.price(eq.reportedEPS)}. <button type="button" class="btn sm primary" data-action="core-earnings">Value on core earnings instead (EPS ≈ ${fmt.price(eq.coreEPS)})</button>`);
  return `<div class="card gap-panel" style="margin-bottom:18px">
    <div class="card-head"><h3>Earnings quality warning</h3><span class="card-note">${inp.coreEarningsApplied ? 'core earnings in use' : inp.normalizedEarningsApplied ? 'normalized earnings in use' : 'confidence reduced by 15'}</span></div>
    <div class="card-body"><ul class="gap-list">${eq.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>${action}
      <p class="note-box" style="margin-top:10px">Core earnings are an estimate: reported profit minus non-operating income, taxed at the company's effective rate${ok(eq.taxRate) ? ` (${(eq.taxRate * 100).toFixed(0)}%)` : ''}. Check the income statement in the latest 10-K/10-Q to see what the non-operating items are — some (like interest on a large cash pile) do recur.</p>
    </div>
  </div>`;
}

// Shown for cyclicals: the verdict uses mid-cycle (normalized) earnings by default, not the current year's.
function cyclicalPanel(inp) {
  const cy = inp.cyclical; if (!cy) return '';
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const rep = inp.reportedEarnings?.epsTTM;
  const p = (html) => `<p style="margin-top:10px; font-size:13px; color:var(--ink-dim)">${html}</p>`;
  const action = !canUseEarningsBasis(inp, 'normalized')
    ? p('Normalized EPS couldn\'t be estimated (average margin ≤ 0 or share count missing), so the verdict uses reported earnings.')
    : inp.normalizedEarningsApplied
      ? p(`Valuing on <b>normalized earnings</b>: EPS ${fmt.price(cy.normalizedEPS)}${ok(rep) ? ` (reported ${fmt.price(rep)})` : ''}. <button type="button" class="btn sm" data-action="reported-earnings">Use reported earnings instead</button>`)
      : p(`The verdict below uses ${inp.coreEarningsApplied ? 'core' : 'reported'} EPS of ${fmt.price(inp.epsTTM)}. <button type="button" class="btn sm primary" data-action="normalized-earnings">Value on normalized earnings (EPS ≈ ${fmt.price(cy.normalizedEPS)})</button>`);
  return `<div class="card gap-panel" style="margin-bottom:18px">
    <div class="card-head"><h3>Cyclical business</h3><span class="card-note">${inp.normalizedEarningsApplied ? 'normalized earnings in use' : 'option available'}</span></div>
    <div class="card-body"><ul class="gap-list">
      <li>${esc(cy.reason[0].toUpperCase() + cy.reason.slice(1))}.</li>
      <li>Operating margin over ${cy.years} fiscal years (${esc(cy.from.slice(0, 4))}–${esc(cy.to.slice(0, 4))}): low ${pct(cy.minMargin)}, high ${pct(cy.maxMargin)}, average ${pct(cy.avgMargin)}${ok(cy.currentMargin) ? `; now ${pct(cy.currentMargin)}` : ''}.</li>
    </ul>${action}
      <p class="note-box" style="margin-top:10px">A cyclical's current-year earnings mislead: near a trough they make the stock look expensive, near a peak cheap. Normalized EPS = average operating margin × current revenue, after ${(cy.taxRate * 100).toFixed(0)}% tax, ÷ diluted shares${ok(cy.capexRatio) ? `; capex is normalized the same way (${(cy.capexRatio * 100).toFixed(0)}% of revenue on average) so owner earnings stay consistent` : ''}. It helps most near a trough; past one, it pulls values <i>down</i>. It assumes margins revert to their ${cy.years}-year average and that current revenue is itself not at an extreme — check both. The growth rate is still seeded from the 5-year EPS trend, which for a cyclical depends on where in the cycle it starts and ends; review it on the Inputs tab.</p>
    </div>
  </div>`;
}

/* ---------------- SUMMARY : STOCK ---------------- */
function renderSummaryStock() {
  const inp = AppState.stock; const { val, gc, bc, lc } = sum(inp); const pf = computePortfolioFit(AppState.portfolio);
  const w = val.why;
  const sub = [inp.sector, inp.periodEnd && `fundamentals through ${inp.periodEnd}`, inp.priceAsOf && `price as of ${inp.priceAsOf}`].filter(Boolean).map(esc).join(' · ');
  return `
  ${reportHead(inp.companyName, sub)}
  ${dataGapsPanel('stock')}
  <div class="stat-row">
    <div class="stat-cell"><div class="stat-label">Price</div><div class="stat-value">${fmt.price(inp.price, inp.__why?.price)}</div></div>
    <div class="stat-cell"><div class="stat-label">Market cap</div><div class="stat-value">${fmt.usd(val.marketCapV, { why: w.marketCapV })}</div></div>
    <div class="stat-cell"><div class="stat-label">P/E (${inp.normalizedEarningsApplied ? 'normalized' : 'TTM'})</div><div class="stat-value">${fmt.x(val.peTTM, 1, w.peTTM)}</div>${ok(inp.epsTTM) ? `<div class="stat-sub">EPS ${fmt.price(inp.epsTTM)} · ${esc(inp.epsBasis || '')}</div>` : ''}</div>
    <div class="stat-cell"><div class="stat-label">Dividend yield</div><div class="stat-value">${fmt.pct(val.dividendYield, 1, w.dividendYield)}</div></div>
  </div>
  ${cyclicalPanel(inp)}
  ${earningsQualityPanel(inp)}
  <div class="card"><div class="card-body">${verdictStampBlock(val.verdict, val.confidence, computeSummaryBottomLine(val) + (val.qualityFlag ? ' Reported earnings include one-off or non-cash items (see the warning above), so treat this verdict with extra caution.' : ''), ` · ${val.methodsEvaluated}/5 valuation methods computable · ${val.filledCount}/${val.completenessFields.length} inputs present`)}</div></div>

  ${priceChartCard()}
  <div class="section-title">Intrinsic value vs. price</div>
  <div class="card"><div class="card-body">
    ${barRow('Graham Number', val.grahamNumber, inp.price, w.grahamNumber)}
    ${barRow('Graham Revised', val.grahamRevised, inp.price, w.grahamRevised)}
    ${barRow('Net-net (⅔ NCAV)', val.netNet, inp.price, w.netNet)}
    ${barRow('Lynch fair value', val.lynchFairValue, inp.price, w.lynchFairValue)}
    ${barRow('DCF (owner earnings)', val.dcfIntrinsic, inp.price, w.dcfIntrinsic)}
    <div class="barchart-row" style="border-top:1px solid var(--border); margin-top:6px; padding-top:12px">
      <span class="barchart-label" style="color:var(--brass-bright)">Current price</span>
      <div class="barchart-track"><div class="barchart-fill" style="width:100%;background:var(--brass-dim)"></div></div>
      <span class="barchart-val" style="color:var(--brass-bright)">${ok(inp.price) ? fmt.price(inp.price) : 'n/a'}</span>
    </div>
  </div></div>

  <div class="section-title">Checklist scorecard</div>
  <div class="grid-3">
    <div class="card"><div class="card-head"><h3><span class="mono-tag g">G</span> Graham</h3></div><div class="card-body"><table class="ledger">
      <tr><td class="lbl">Defensive screen</td><td class="val">${gc.defensivePassCount}</td></tr>
      <tr><td class="lbl">Enterprising screen</td><td class="val">${gc.enterprisingPassCount}</td></tr>
    </table></div></div>
    <div class="card"><div class="card-head"><h3><span class="mono-tag b">B</span> Buffett</h3></div><div class="card-body"><table class="ledger">
      <tr><td class="lbl">Quality grade</td><td class="val" style="font-size:12.5px">${esc(bc.grade)}</td></tr>
      <tr><td class="lbl">Quality score</td><td class="val">${ok(bc.qualityScore) ? fmt.num(bc.qualityScore, 0) + '/100' : unav()}</td></tr>
    </table></div></div>
    <div class="card"><div class="card-head"><h3><span class="mono-tag l">L</span> Lynch</h3></div><div class="card-body"><table class="ledger">
      <tr><td class="lbl">Verdict</td><td class="val" style="font-size:12px">${esc(lc.verdict)}</td></tr>
      <tr><td class="lbl">PEG ratio</td><td class="val">${fmt.num(val.lynchPEG, 2, w.lynchPEG)}</td></tr>
    </table></div></div>
  </div>

  <div class="grid-2" style="margin-top:14px">
    <div class="card"><div class="card-head"><h3>Portfolio fit</h3></div><div class="card-body">
      <table class="ledger"><tr><td class="lbl">Verdict</td><td class="val ${pf.verdict.includes('FITS') ? 'good' : pf.verdict.includes('AVOID') ? 'bad' : 'watch'}" style="font-size:13px">${pf.verdict}</td></tr></table>
    </div></div>
    <div class="card"><div class="card-head"><h3>Owner earnings</h3></div><div class="card-body"><table class="ledger">
      <tr><td class="lbl">Owner earnings (Buffett)</td><td class="val">${fmt.usd(val.ownerEarnings, { why: w.ownerEarnings })}</td></tr>
      <tr><td class="lbl">Owner-earnings yield</td><td class="val">${fmt.pct(val.ownerEarningsYield, 1, w.ownerEarningsYield)}</td></tr>
    </table></div></div>
  </div>
  <p class="note-box" style="margin-top:16px">All figures flow from the Inputs &amp; Sources tab. Edit any field there (or on the Valuation / Graham / Buffett / Lynch tabs) and this page recomputes instantly. Moat, management, simplicity, stability, and accounting quality start at a neutral 3/5 — score them yourself; they move the verdict.</p>`;
}

/* ---------------- VALUATION (stock) ---------------- */
function renderValuation() {
  const inp = AppState.stock; const val = computeValuation(inp); const w = val.why;
  const methodRow = (name, formula, k, mosVal, signal) => `
    <tr class="${signal === 'Undervalued' ? 'hl' : ''}">
      <td class="name">${name}<span class="fml">${formula}</span></td>
      <td class="num">${fmt.price(val[k], w[k])}</td>
      <td class="num">${ok(mosVal) ? fmt.pct(mosVal) : 'n/a'}</td>
      <td>${pill(signal)}</td>
    </tr>`;
  const L = (label, hint) => `<td class="lbl">${label}${hint ? `<span class="hint">${hint}</span>` : ''}</td>`;
  const d = val.dcf;
  return `
  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h3>Per-share &amp; quality metrics</h3><span class="card-note">Valuation_Stock rows 7–28</span></div>
      <div class="card-body"><table class="ledger">
        <tr>${L('EPS (TTM, diluted)', esc(inp.epsBasis || ''))}<td class="val">${fmt.price(val.epsTTM, w.epsTTM)}</td></tr>
        <tr>${L('Book value / share', "Graham's P/B denominator")}<td class="val">${fmt.price(val.bookValuePerShare, w.bookValuePerShare)}</td></tr>
        <tr>${L('Tangible book / share')}<td class="val">${fmt.price(val.tangibleBookPerShare, w.tangibleBookPerShare)}</td></tr>
        <tr>${L('NCAV / share', "Graham's liquidation floor")}<td class="val ${ok(val.ncavPerShare) && val.ncavPerShare < 0 ? 'bad' : ''}">${fmt.price(val.ncavPerShare, w.ncavPerShare)}</td></tr>
        <tr>${L('FCF / share')}<td class="val">${fmt.price(val.fcfPerShare, w.fcfPerShare)}</td></tr>
        <tr>${L('Owner earnings / share', 'Net income + D&amp;A − capex')}<td class="val">${fmt.price(val.ownerEarningsPerShare, w.ownerEarningsPerShare)}</td></tr>
        <tr class="total">${L('Current ratio', '≥2.0 = strong (Graham)')}<td class="val ${ok(val.currentRatio) ? (val.currentRatio >= 2 ? 'good' : 'bad') : ''}">${fmt.x(val.currentRatio, 2, w.currentRatio)}</td></tr>
        <tr>${L('Debt / equity (computed)')}<td class="val">${fmt.x(val.debtToEquity, 2, w.debtToEquity)}</td></tr>
        <tr>${L('Interest coverage', 'EBIT / interest')}<td class="val">${fmt.x(val.interestCoverage, 1, w.interestCoverage)}</td></tr>
        <tr>${L('Net margin')}<td class="val">${fmt.pct(val.netMargin, 1, w.netMargin)}</td></tr>
        <tr>${L('ROE (5yr avg)')}<td class="val">${fmt.pct(val.roe, 1, w.roe)}</td></tr>
        <tr>${L('ROIC (approx, latest)')}<td class="val">${fmt.pct(val.roic, 1, w.roic)}</td></tr>
        <tr>${L('Owner-earnings yield', 'vs. bond yield (Buffett)')}<td class="val">${fmt.pct(val.ownerEarningsYield, 1, w.ownerEarningsYield)}</td></tr>
        <tr>${L('FCF yield')}<td class="val">${fmt.pct(val.fcfYield, 1, w.fcfYield)}</td></tr>
        <tr>${L('Earnings yield', 'Inverse of P/E')}<td class="val">${fmt.pct(val.earningsYield, 1, w.earningsYield)}</td></tr>
        <tr>${L('P/E (TTM)')}<td class="val">${fmt.x(val.peTTM, 1, w.peTTM)}</td></tr>
        <tr>${L('P/B')}<td class="val">${fmt.x(val.pb, 2, w.pb)}</td></tr>
        <tr>${L('Dividend yield')}<td class="val">${fmt.pct(val.dividendYield, 2, w.dividendYield)}</td></tr>
      </table></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>DCF build — owner earnings</h3><span class="card-note">10-yr, Gordon growth terminal</span></div>
      <div class="card-body">
        ${!d ? `<p class="note-box warn">DCF can't run: ${esc(w.dcf)}.</p>` : `
        <table class="ledger">
          <tr><td class="lbl">Base owner earnings</td><td class="val">${fmt.usd(d.baseOwnerEarnings)}</td></tr>
          <tr><td class="lbl">Growth g (expected)</td><td class="val">${fmt.pct(d.g)}</td></tr>
          <tr><td class="lbl">Discount rate r</td><td class="val">${fmt.pct(d.r)}</td></tr>
          <tr><td class="lbl">Terminal growth</td><td class="val">${fmt.pct(d.termGrowth)}</td></tr>
          <tr><td class="lbl">Excess cash</td><td class="val">${fmt.usd(d.excessCash)}</td></tr>
          <tr><td class="lbl">Total debt</td><td class="val">${fmt.usd(d.totalDebt)}</td></tr>
          <tr class="total"><td class="lbl">Terminal value</td><td class="val">${fmt.usd(d.terminalValue, { why: w.dcf })}</td></tr>
          <tr><td class="lbl">PV of terminal</td><td class="val">${fmt.usd(d.pvTerminal, { why: w.dcf })}</td></tr>
          <tr><td class="lbl">Enterprise value<span class="hint">Σ PV(10yr cash flows) + PV(terminal)</span></td><td class="val">${fmt.usd(d.enterpriseValue, { why: w.dcf })}</td></tr>
          <tr><td class="lbl">Equity value<span class="hint">EV + excess cash − debt</span></td><td class="val">${fmt.usd(d.equityValue, { why: w.dcf })}</td></tr>
          <tr class="total"><td class="lbl">DCF value / share</td><td class="val ${d.sanityOk ? '' : 'bad'}">${fmt.price(d.valuePerShare, w.dcf)}</td></tr>
        </table>
        ${!d.sanityOk ? `<p class="note-box warn" style="margin-top:10px">Discount rate must exceed terminal growth — the Gordon growth formula is undefined here. Raise the discount rate or lower terminal growth on the Inputs &amp; Sources tab.</p>` : ''}
        <details style="margin-top:12px"><summary style="cursor:pointer; color:var(--ink-faint); font-size:12px">Year-by-year projection</summary>
          <table class="data-table" style="margin-top:8px">
            <tr><th>Year</th><th class="num">Owner earnings</th><th class="num">Disc. factor</th><th class="num">PV</th></tr>
            ${val.dcfYears.map(y => `<tr><td>${y.yr}</td><td class="num">${fmt.usd(y.fcfYear)}</td><td class="num">${y.discFactor.toFixed(3)}</td><td class="num">${fmt.usd(y.pv)}</td></tr>`).join('')}
          </table>
        </details>`}
      </div>
    </div>
  </div>

  <div class="section-title">Five valuation methods</div>
  <div class="card"><div class="card-body no-pad">
    <table class="data-table">
      <tr><th>Method</th><th class="num">Intrinsic value / share</th><th class="num">Margin of safety</th><th>Signal</th></tr>
      ${methodRow('Graham Number', '√(22.5 × EPS × book value/share)', 'grahamNumber', val.grahamNumberMOS, val.grahamNumberSignal)}
      ${methodRow('Graham Revised', 'EPS × (8.5 + 2g) × 4.4 / Y', 'grahamRevised', val.grahamRevisedMOS, val.grahamRevisedSignal)}
      ${methodRow('Net-net (⅔ NCAV)', '⅔ × (current assets − liabilities) / shares', 'netNet', val.netNetMOS, val.netNetSignal)}
      ${methodRow('Lynch fair value', 'EPS × growth rate (fair P/E ≈ growth)', 'lynchFairValue', val.lynchFairValueMOS, val.lynchFairValueSignal)}
      ${methodRow('DCF (owner earnings)', 'Equity value ÷ shares', 'dcfIntrinsic', val.dcfMOS, val.dcfSignal)}
      <tr><td class="name">Lynch PEG ratio<span class="fml">P/E ÷ growth rate</span></td><td class="num">${fmt.num(val.lynchPEG, 2, w.lynchPEG)}</td><td class="num">—</td><td>${pill(val.lynchPEGSignal)}</td></tr>
    </table>
  </div></div>
  <div class="grid-3" style="margin-top:14px">
    <div class="card"><div class="card-body"><table class="ledger"><tr><td class="lbl"># methods meeting required MOS</td><td class="val">${val.methodsPassingMOS} / ${val.methodsEvaluated}${val.methodsEvaluated < 5 ? ` <span style="color:var(--ink-faint);font-size:11px">(of 5)</span>` : ''}</td></tr></table></div></div>
    <div class="card"><div class="card-body"><table class="ledger"><tr><td class="lbl">Quality score</td><td class="val">${fmt.num(val.qualityScore, 0)}/100</td></tr></table></div></div>
    <div class="card"><div class="card-body"><table class="ledger"><tr><td class="lbl">Required margin of safety</td><td class="val">${efield('stock', 'requiredMOS', inp.requiredMOS, { transform: 'pct', step: '1' })}</td></tr></table></div></div>
  </div>
  <p class="note-box" style="margin-top:14px">Methods that can't produce a positive value say why instead of showing a false "Undervalued": net-net needs current assets above total liabilities, Graham Revised needs positive EPS and growth, PEG needs positive growth, and the DCF needs a discount rate above terminal growth.</p>`;
}

/* ---------------- GRAHAM ---------------- */
function renderGraham() {
  const inp = AppState.stock; const val = computeValuation(inp); const gc = computeGrahamChecklist(inp, val);
  const show = (kind, v) => !ok(v) ? 'n/a' : kind === 'pct' ? fmt.pct(v) : kind === 'usd' ? fmt.usd(v) : kind === 'int' ? fmt.int(v) : kind === 'x' ? fmt.x(v, 2) : fmt.num(v);
  const rowsHtml = (rows) => rows.map(r => `
    <div class="check-row">
      <div class="cr-main"><div class="cr-title">${r.label}</div><div class="cr-detail">threshold ${show(r.fmt, r.threshold)} · actual ${show(r.fmt, r.actual)}</div>${r.note ? `<div class="cr-note">${esc(r.note)}</div>` : ''}</div>
      ${pill(r.pass)}
    </div>`).join('');
  return `
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3><span class="mono-tag g">G</span> Defensive Investor</h3><span class="card-note">${gc.defensivePassCount}</span></div><div class="card-body">${rowsHtml(gc.defensiveList)}</div></div>
    <div class="card"><div class="card-head"><h3><span class="mono-tag g">G</span> Enterprising Investor</h3><span class="card-note">${gc.enterprisingPassCount}</span></div><div class="card-body">${rowsHtml(gc.enterprisingList)}</div></div>
  </div>
  <p class="note-box" style="margin-top:16px">Graham's central idea: buy with a margin of safety of 25–50% below intrinsic value. <b>NO DATA</b> means an input is missing; <b>UNVERIFIED</b> means the record is clean as far as SEC's machine-readable history goes (~2009 onward) but that history is too short to confirm the full test — check older annual reports by hand.</p>`;
}

/* ---------------- BUFFETT ---------------- */
function renderBuffett() {
  const inp = AppState.stock; const val = computeValuation(inp); const bc = computeBuffettChecklist(inp, val);
  const dotsHtml = (score) => `<span class="dots">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= score ? 'on' : ''}"></i>`).join('')}</span>`;
  return `
  <div class="card">
    <div class="card-head"><h3><span class="mono-tag b">B</span> Quality factors</h3><span class="card-note">Score each 0–5 → grade 0–100</span></div>
    <div class="card-body">
      ${bc.list.map(f => `<div class="check-row"><div class="cr-main"><div class="cr-title">${f.label}</div><div class="cr-detail">${f.why}</div>${f.score == null ? `<div class="cr-note">Not scored: ${esc(f.missing)}</div>` : ''}</div><div class="cr-score">${f.score == null ? pill('NO DATA') : `${dotsHtml(f.score)} ${f.score}/5`}</div></div>`).join('')}
    </div>
  </div>
  <div class="grid-2" style="margin-top:14px">
    <div class="card"><div class="card-body"><table class="ledger"><tr class="total"><td class="lbl">Quality score${bc.scoredCount < 9 ? `<span class="hint">based on the ${bc.scoredCount} factors with data</span>` : ''}</td><td class="val">${ok(bc.qualityScore) ? fmt.num(bc.qualityScore, 1) + '/100' : unav()}</td></tr></table></div></div>
    <div class="card"><div class="card-body"><table class="ledger"><tr class="total"><td class="lbl">Buffett grade</td><td class="val">${esc(bc.grade)}</td></tr></table></div></div>
  </div>
  <p class="note-box" style="margin-top:16px">Buffett's two rules: (1) don't lose money; (2) don't forget rule one. A high quality grade without a margin of safety is not a buy — cross-check against the DCF margin of safety on the Valuation tab. Business-quality factors start at a neutral 3/5 until you score them on Inputs &amp; Sources.</p>`;
}

/* ---------------- LYNCH ---------------- */
function renderLynch() {
  const inp = AppState.stock; const val = computeValuation(inp); const L = AppState.lynch; const lc = computeLynchChecklist({ ...inp, ...L }, val);
  const pitfallRow = (label, field) => `<div class="check-row"><div class="cr-main"><div class="cr-title">${label}</div></div>${efield('lynch', field, L[field], { type: 'select', options: ['No', 'Yes'] })}</div>`;
  return `
  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h3><span class="mono-tag l">L</span> Category &amp; story</h3></div>
      <div class="card-body">
        <table class="ledger"><tr><td class="lbl">Category<span class="hint">Drives the sell rule</span></td><td class="val">${efield('lynch', 'lynchCategory', L.lynchCategory, { type: 'select', options: ['Slow Grower', 'Stalwart', 'Fast Grower', 'Cyclical', 'Turnaround', 'Asset Play'] })}</td></tr></table>
        <div style="margin-top:12px"><label style="display:block; margin-bottom:6px; color:var(--ink-faint); font-size:12px">The story — one paragraph: can you explain why you own it?</label>${efield('lynch', 'lynchStory', L.lynchStory, { type: 'textarea' })}</div>
        <div class="section-title" style="margin-top:20px">Pitfalls to rule out</div>
        ${pitfallRow('Di-worse-ification (unrelated acquisitions)', 'lynchDiworsification')}
        ${pitfallRow('Hot industry / whisper stock / over-promotion', 'lynchHotIndustry')}
        ${pitfallRow('Accounting red flags', 'lynchAccountingRedFlags')}
        ${pitfallRow('Excessive debt for the category', 'lynchExcessiveDebt')}
        ${pitfallRow('Story already widely known / priced in', 'lynchStoryPricedIn')}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Numbers</h3></div>
      <div class="card-body">
        <table class="ledger">
          <tr><td class="lbl">P/E (TTM)</td><td class="val">${fmt.x(lc.peTTM, 1, val.why.peTTM)}</td></tr>
          <tr><td class="lbl">Expected EPS growth</td><td class="val">${fmt.pct(lc.expectedGrowth)}</td></tr>
          <tr class="total"><td class="lbl">PEG ratio<span class="hint">&lt;1 cheap · 1–1.5 fair · &gt;1.5 expensive</span></td><td class="val">${fmt.num(lc.peg, 2, val.why.lynchPEG)}</td></tr>
          <tr><td class="lbl">PEG + dividend yield (adj)</td><td class="val">${fmt.num(lc.pegDivAdj, 2, 'needs P/E, positive growth and dividend yield')}</td></tr>
          <tr><td class="lbl">Debt / equity</td><td class="val">${fmt.x(lc.debtToEquity, 2, val.why.debtToEquity)}</td></tr>
          <tr><td class="lbl">Dividend yield</td><td class="val">${fmt.pct(lc.dividendYield, 2, val.why.dividendYield)}</td></tr>
          <tr><td class="lbl">Inventory &amp; receivables vs. sales<span class="hint">Lower/faster than sales = healthy</span></td><td class="val">${efield('lynch', 'lynchInventoryNote', L.lynchInventoryNote, { type: 'text' })}</td></tr>
          <tr><td class="lbl">Insider ownership / buybacks<span class="hint">Insiders buying = good signal</span></td><td class="val">${efield('lynch', 'lynchInsiderNote', L.lynchInsiderNote, { type: 'text' })}</td></tr>
        </table>
        <div class="card" style="margin-top:16px; background:var(--surface-2)"><div class="card-body"><div class="cr-detail" style="margin-bottom:6px">PEG signal</div>${pill(lc.pegSignal)}</div></div>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><div class="card-body">
    <table class="ledger"><tr class="total"><td class="lbl">Lynch verdict${!ok(lc.peg) && !lc.verdict.startsWith('AVOID') && !lc.verdict.startsWith('Check') ? `<span class="hint miss">${esc(val.why.lynchPEG)}</span>` : ''}</td><td class="val" style="font-size:14px">${esc(lc.verdict)}</td></tr></table>
  </div></div>
  <p class="note-box" style="margin-top:16px">Cyclical caveat: for cyclicals, a high P/E at the trough (earnings depressed) can be a buy signal, and a low P/E at the peak can be a sell signal — invert the usual P/E logic rather than reading it mechanically.</p>`;
}

/* ============================================================================
   PART 7 — RENDER: Funds/ETFs, Bonds, Portfolio Fit, Inputs & Sources
   ============================================================================ */

function renderSummaryFund() {
  const f = AppState.fund; const c = computeFundsETFs(f); const pf = computePortfolioFit(AppState.portfolio); const fw = f.__why || {};
  return `
  ${reportHead(f.fundName, f.priceAsOf ? `price as of ${esc(f.priceAsOf)}` : '')}
  ${dataGapsPanel('fund', ['price', 'expenseRatio', 'return1y', 'return5y', 'return10y', 'benchReturn5y', 'benchReturn10y', 'sharpeRatio', 'stdDev', 'maxDrawdown', 'yield', 'aum'])}
  <div class="stat-row">
    <div class="stat-cell"><div class="stat-label">Price</div><div class="stat-value">${fmt.price(f.price, fw.price)}</div></div>
    <div class="stat-cell"><div class="stat-label">Expense ratio</div><div class="stat-value">${fmt.pct(f.expenseRatio, 2, fw.expenseRatio)}</div></div>
    <div class="stat-cell"><div class="stat-label">5yr excess return</div><div class="stat-value ${ok(c.excessReturn5y) ? (c.excessReturn5y >= 0 ? 'good' : 'bad') : ''}">${fmt.pct(c.excessReturn5y, 2, c.why.excessReturn5y)}</div></div>
    <div class="stat-cell"><div class="stat-label">Sharpe ratio (5yr)</div><div class="stat-value">${fmt.num(f.sharpeRatio, 2, fw.sharpeRatio)}</div></div>
  </div>
  <div class="card" style="margin-bottom:18px"><div class="card-body">${verdictStampBlock(c.verdict, null, c.caveats.join(' '))}</div></div>
  ${priceChartCard()}
  <div class="grid-3" style="margin-top:14px">
    <div class="card"><div class="card-body"><table class="ledger"><tr><td class="lbl">Fee drag / 10yr</td><td class="val">${fmt.pct(c.feeDrag10y, 2, c.why.feeDrag10y)}</td></tr></table></div></div>
    <div class="card"><div class="card-body"><table class="ledger"><tr><td class="lbl">5yr total return (ann.)</td><td class="val">${fmt.pct(f.return5y, 2, fw.return5y)}</td></tr></table></div></div>
    <div class="card"><div class="card-body"><table class="ledger"><tr><td class="lbl">Distribution yield (TTM)</td><td class="val">${fmt.pct(f.yield, 2, fw.yield)}</td></tr></table></div></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="card-head"><h3>Portfolio fit</h3></div><div class="card-body">
    <table class="ledger"><tr><td class="lbl">Verdict</td><td class="val ${pf.verdict.includes('FITS') ? 'good' : pf.verdict.includes('AVOID') ? 'bad' : 'watch'}">${pf.verdict}</td></tr></table>
  </div></div>
  <p class="note-box" style="margin-top:16px">Returns are total returns computed from Yahoo's dividend-adjusted closing prices (3/5/10-yr figures annualized). Expense ratio, AUM, turnover, and holdings data aren't published by any free keyless source — values marked default come from a small built-in reference list; verify them against the fund's prospectus.</p>`;
}

function renderSummaryBond() {
  const b = AppState.bond; const c = computeBonds(b); const pf = computePortfolioFit(AppState.portfolio); const bw = b.__why || {};
  const isFund = b.bondType === 'Bond ETF';
  return `
  ${reportHead(b.issuer, b.priceAsOf ? `price as of ${esc(b.priceAsOf)}` : '')}
  ${dataGapsPanel('bond')}
  <div class="stat-row">
    <div class="stat-cell"><div class="stat-label">${isFund ? 'Share price' : 'Price (per 100 par)'}</div><div class="stat-value">${fmt.price(b.price, bw.price)}</div></div>
    <div class="stat-cell"><div class="stat-label">Yield to worst</div><div class="stat-value">${fmt.pct(b.ytw, 2, bw.ytw)}</div></div>
    <div class="stat-cell"><div class="stat-label">Duration</div><div class="stat-value">${ok(b.modDuration) ? fmt.num(b.modDuration, 1) + ' yr' : unav(bw.modDuration)}</div></div>
    <div class="stat-cell"><div class="stat-label">Credit spread</div><div class="stat-value ${ok(c.creditSpread) ? (c.creditSpread >= 0.005 ? 'good' : 'bad') : ''}">${fmt.pct(c.creditSpread, 2, c.why.creditSpread)}</div></div>
  </div>
  <div class="card"><div class="card-body">${verdictStampBlock(c.verdict, null, c.verdict.startsWith('INCOMPLETE') ? (isFund ? "Copy the fund's average yield-to-maturity (or SEC 30-day yield) and effective duration from its fact sheet into Bond Detail." : 'Enter the bond’s YTM, YTW, duration and coupon on Bond Detail.') : '')}</div></div>
  <div style="margin-top:18px">${AppState.priceHistory ? priceChartCard() : ''}</div>
  <div class="grid-3" style="margin-top:14px">
    <div class="card"><div class="card-body"><table class="ledger"><tr><td class="lbl">Real yield (Fisher)</td><td class="val ${ok(c.realYield) ? (c.realYield > 0 ? 'good' : 'bad') : ''}">${fmt.pct(c.realYield, 2, c.why.realYield)}</td></tr></table></div></div>
    <div class="card"><div class="card-body"><table class="ledger"><tr><td class="lbl">Expected return (adj.)</td><td class="val">${fmt.pct(c.expectedReturnAdj, 2, c.why.expectedReturnAdj)}</td></tr></table></div></div>
    <div class="card"><div class="card-body"><table class="ledger"><tr><td class="lbl">${isFund ? 'Distribution yield (TTM)' : 'Current yield'}</td><td class="val">${fmt.pct(c.currentYield, 2, c.why.currentYield)}</td></tr></table></div></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="card-head"><h3>Portfolio fit</h3></div><div class="card-body">
    <table class="ledger"><tr><td class="lbl">Verdict</td><td class="val ${pf.verdict.includes('FITS') ? 'good' : pf.verdict.includes('AVOID') ? 'bad' : 'watch'}">${pf.verdict}</td></tr></table>
  </div></div>
  <p class="note-box" style="margin-top:16px">${isFund ? "For a bond fund, price and trailing distributions are fetched live; the fund's yield-to-maturity and duration are published only on the provider's fact sheet (no free API), so the verdict waits until you enter them. The trailing distribution yield is an income measure, not YTM." : 'No free public feed carries pricing for individual bonds by CUSIP — every field here needs your own entry (from a broker confirm, FINRA TRACE, or your statement).'}</p>`;
}

/* ---------------- FUNDS / ETFs detail ---------------- */
function renderFunds() {
  const f = AppState.fund; const c = computeFundsETFs(f);
  const row = (label, field, opts = {}) => `<tr><td class="lbl">${label}${opts.hint ? `<span class="hint">${opts.hint}</span>` : ''}${missHint('fund', field)}</td><td class="val">${srcDot('fund', field)}${efield('fund', field, f[field], opts)}</td></tr>`;
  return `
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Fund inputs</h3></div><div class="card-body"><table class="ledger">
      <tr><td class="lbl">Fund name</td><td class="val">${efield('fund', 'fundName', f.fundName, { type: 'text', wide: true })}</td></tr>
      <tr><td class="lbl">Fund type</td><td class="val">${efield('fund', 'fundType', f.fundType, { type: 'select', options: ['Index ETF', 'Active ETF', 'Active Mutual Fund', 'Index Mutual Fund'] })}</td></tr>
      <tr><td class="lbl">Benchmark</td><td class="val">${efield('fund', 'benchmark', f.benchmark, { type: 'text' })}</td></tr>
      ${row('Price', 'price', { step: '0.01' })}
      ${row('Expense ratio', 'expenseRatio', { transform: 'pct', step: '0.01' })}
      ${row('AUM ($)', 'aum')}
      ${row('Turnover ratio', 'turnoverRatio', { transform: 'pct', step: '1' })}
      ${row('Manager tenure (yrs)', 'managerTenure')}
      ${row('# holdings', 'numHoldings')}
      ${row('Top-10 concentration', 'top10Concentration', { transform: 'pct', step: '1' })}
      ${row('Active share', 'activeShare', { transform: 'pct', step: '1' })}
      ${row('Tracking error (annual)', 'trackingError', { transform: 'pct', step: '0.1' })}
    </table></div></div>
    <div class="card"><div class="card-head"><h3>Returns &amp; risk</h3><span class="card-note">total return</span></div><div class="card-body"><table class="ledger">
      ${row('1-yr return', 'return1y', { transform: 'pct', step: '0.1' })}
      ${row('3-yr return (annualized)', 'return3y', { transform: 'pct', step: '0.1' })}
      ${row('5-yr return (annualized)', 'return5y', { transform: 'pct', step: '0.1' })}
      ${row('10-yr return (annualized)', 'return10y', { transform: 'pct', step: '0.1' })}
      ${row('Benchmark 5-yr return (ann.)', 'benchReturn5y', { transform: 'pct', step: '0.1' })}
      ${row('Benchmark 10-yr return (ann.)', 'benchReturn10y', { transform: 'pct', step: '0.1' })}
      ${row('Std. deviation (annual, 5yr)', 'stdDev', { transform: 'pct', step: '0.1' })}
      ${row('Sharpe ratio (5yr)', 'sharpeRatio', { step: '0.01' })}
      ${row('Max drawdown (5yr)', 'maxDrawdown', { transform: 'pct', step: '0.1' })}
      ${row('Distribution yield (TTM)', 'yield', { transform: 'pct', step: '0.01' })}
      ${row('Premium / discount', 'premiumDiscount', { transform: 'pct', step: '0.01' })}
      ${row('Tax-cost ratio', 'taxCostRatio', { transform: 'pct', step: '0.01' })}
    </table></div></div>
  </div>
  <div class="section-title">Computed</div>
  <div class="card"><div class="card-body"><table class="ledger">
    <tr><td class="lbl">5-yr excess return (alpha)</td><td class="val ${ok(c.excessReturn5y) ? (c.excessReturn5y >= 0 ? 'good' : 'bad') : ''}">${fmt.pct(c.excessReturn5y, 2, c.why.excessReturn5y)}</td></tr>
    <tr><td class="lbl">10-yr excess return</td><td class="val ${ok(c.excessReturn10y) ? (c.excessReturn10y >= 0 ? 'good' : 'bad') : ''}">${fmt.pct(c.excessReturn10y, 2, c.why.excessReturn10y)}</td></tr>
    <tr><td class="lbl">Fee drag over 10 yrs</td><td class="val">${fmt.pct(c.feeDrag10y, 2, c.why.feeDrag10y)}</td></tr>
    <tr><td class="lbl">Net cost / $10k / 10yr</td><td class="val">${fmt.usd(c.netCostPer10k, { abbreviate: false, why: c.why.netCostPer10k })}</td></tr>
    <tr class="total"><td class="lbl">Verdict</td><td class="val" style="font-size:13px">${esc(c.verdict)}</td></tr>
  </table></div></div>
  <p class="note-box" style="margin-top:16px">Index ETF: low expense ratio (≲0.05%), small tracking difference/error, adequate AUM/liquidity. Active fund: repeatable process, manager tenure, alpha after fees, reasonable expense, low style drift. Costs compound — that's why expense ratio carries so much weight in the verdict.</p>`;
}

/* ---------------- BONDS detail ---------------- */
function renderBonds() {
  const b = AppState.bond; const c = computeBonds(b); const isFund = b.bondType === 'Bond ETF';
  const row = (label, field, opts = {}) => `<tr><td class="lbl">${label}${opts.hint ? `<span class="hint">${opts.hint}</span>` : ''}${missHint('bond', field)}</td><td class="val">${srcDot('bond', field)}${efield('bond', field, b[field], opts)}</td></tr>`;
  return `
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Bond inputs</h3></div><div class="card-body"><table class="ledger">
      <tr><td class="lbl">Issuer / security</td><td class="val">${efield('bond', 'issuer', b.issuer, { type: 'text', wide: true })}</td></tr>
      <tr><td class="lbl">Bond type</td><td class="val">${efield('bond', 'bondType', b.bondType, { type: 'select', options: ['Bond ETF', 'Individual bond', 'Treasury', 'Corporate', 'Municipal'] })}</td></tr>
      <tr><td class="lbl">Credit rating</td><td class="val">${efield('bond', 'creditRating', b.creditRating, { type: 'text' })}</td></tr>
      <tr><td class="lbl">Tax status</td><td class="val">${efield('bond', 'taxStatus', b.taxStatus, { type: 'select', options: ['Taxable', 'Tax-exempt (muni)'] })}</td></tr>
      ${row(isFund ? 'Share price' : 'Price (per 100 par)', 'price', { step: '0.01' })}
      ${isFund ? row('Distribution yield (TTM)', 'distributionYield', { transform: 'pct', step: '0.01', hint: 'income yield, not YTM' }) : ''}
      ${row('Yield to maturity (YTM)', 'ytm', { transform: 'pct', step: '0.01', hint: isFund ? "fund's average YTM from its fact sheet" : '' })}
      ${row('Yield to worst (YTW)', 'ytw', { transform: 'pct', step: '0.01', hint: isFund ? 'for most funds, use the same YTM / SEC yield' : '' })}
      ${row(isFund ? 'Effective duration' : 'Modified duration', 'modDuration', { step: '0.1' })}
      ${isFund ? '' : row('Coupon rate (annual)', 'couponRate', { transform: 'pct', step: '0.01' })}
      ${isFund ? '' : row('Par / face value', 'parValue', { step: '1' })}
      ${isFund ? '' : row('Years to maturity', 'yearsToMaturity', { step: '0.1' })}
      ${isFund ? '' : row('Convexity', 'convexity', { step: '1' })}
    </table></div></div>
    <div class="card"><div class="card-head"><h3>Risk &amp; tax assumptions</h3></div><div class="card-body">
      <table class="ledger">
        ${row('Marginal tax rate', 'marginalTaxRate', { transform: 'pct', step: '1' })}
        ${row('Inflation assumption', 'inflationAssumption', { transform: 'pct', step: '0.1' })}
        ${row('Default probability (annual)', 'defaultProbability', { transform: 'pct', step: '0.1' })}
        ${row('Recovery rate', 'recoveryRate', { transform: 'pct', step: '1' })}
        ${row('Comparable Treasury yield', 'comparableTreasuryYield', { transform: 'pct', step: '0.01' })}
      </table>
      <div class="section-title">Computed</div>
      <table class="ledger">
        <tr><td class="lbl">${isFund ? 'Distribution yield' : 'Current yield'}</td><td class="val">${fmt.pct(c.currentYield, 2, c.why.currentYield)}</td></tr>
        <tr><td class="lbl">Approx. YTM</td><td class="val">${fmt.pct(c.approxYTM, 2, c.why.approxYTM)}</td></tr>
        <tr><td class="lbl">Tax-equivalent yield</td><td class="val">${fmt.pct(c.taxEquivalentYield, 2, c.why.taxEquivalentYield)}</td></tr>
        <tr><td class="lbl">Real yield (Fisher)</td><td class="val ${ok(c.realYield) ? (c.realYield > 0 ? 'good' : 'bad') : ''}">${fmt.pct(c.realYield, 2, c.why.realYield)}</td></tr>
        <tr><td class="lbl">Credit spread</td><td class="val ${ok(c.creditSpread) ? (c.creditSpread >= 0.005 ? 'good' : 'bad') : ''}">${fmt.pct(c.creditSpread, 2, c.why.creditSpread)}</td></tr>
        <tr><td class="lbl">Expected loss</td><td class="val">${fmt.pct(c.expectedLoss, 2, c.why.expectedLoss)}</td></tr>
        <tr><td class="lbl">Expected return (adj.)</td><td class="val">${fmt.pct(c.expectedReturnAdj, 2, c.why.expectedReturnAdj)}</td></tr>
        <tr><td class="lbl">Duration price impact / +1% yield</td><td class="val ${ok(c.durationImpact) ? 'bad' : ''}">${fmt.pct(c.durationImpact, 2, c.why.durationImpact)}</td></tr>
        <tr class="total"><td class="lbl">Verdict</td><td class="val" style="font-size:13px">${esc(c.verdict)}</td></tr>
      </table>
    </div></div>
  </div>
  <p class="note-box" style="margin-top:16px">A bond is attractive only if yield-to-worst beats the comparable Treasury by a spread that compensates for credit/default/call/liquidity risk, the real yield is positive, and duration fits your horizon. Never chase yield without sizing the risk.</p>`;
}

/* ---------------- PORTFOLIO FIT (shared) ---------------- */
function renderPortfolio() {
  const p = AppState.portfolio; const c = computePortfolioFit(p);
  const row = (label, field, opts = {}) => `<tr><td class="lbl">${label}</td><td class="val">${efield('portfolio', field, p[field], opts)}</td></tr>`;
  return `
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Position &amp; horizon</h3></div><div class="card-body"><table class="ledger">
      ${row('Intended position size (% of portfolio)', 'intendedPositionSize', { transform: 'pct', step: '0.5' })}
      ${row('Max position size (% of portfolio)', 'maxPositionSize', { transform: 'pct', step: '0.5' })}
      ${row('Time horizon (yrs)', 'timeHorizon', { step: '1' })}
      ${row('Liquidity need (yrs to cash)', 'liquidityNeed', { step: '1' })}
      ${row('Correlation to rest of portfolio', 'correlation', { step: '0.05' })}
      <tr><td class="lbl">Role in portfolio</td><td class="val">${efield('portfolio', 'role', p.role, { type: 'text' })}</td></tr>
      ${row('Conviction (0–5)', 'conviction', { step: '1' })}
    </table></div></div>
    <div class="card"><div class="card-head"><h3>Fit check</h3></div><div class="card-body">
      <div class="check-row"><div class="cr-main"><div class="cr-title">Position within limit</div></div>${pill(c.positionWithinLimit ? 'PASS' : 'FAIL')}</div>
      <div class="check-row"><div class="cr-main"><div class="cr-title">Horizon &gt; liquidity need</div></div>${pill(c.horizonOk ? 'PASS' : 'FAIL')}</div>
      <div class="check-row"><div class="cr-main"><div class="cr-title">Conviction adequate (≥3)</div></div>${pill(c.convictionOk ? 'PASS' : 'FAIL')}</div>
      <table class="ledger" style="margin-top:10px"><tr class="total"><td class="lbl">Final verdict</td><td class="val" style="font-size:13px">${c.verdict}</td></tr></table>
    </div></div>
  </div>
  <p class="note-box" style="margin-top:16px">All three masters agree: a cheap asset is not automatically a buy. It must fit your temperament, time horizon, concentration limits, and liquidity needs. This tab is entirely personal — nothing here is fetched.</p>`;
}

/* ---------------- INPUTS & SOURCES ---------------- */
const STOCK_FIELD_GROUPS = [
  { title: 'Company & market data', fields: [['companyName', 'Company name', 'text'], ['sector', 'Sector', 'text'], ['price', 'Current price ($)', 'num'], ['dilutedShares', 'Shares outstanding', 'num']] },
  { title: 'Income statement (TTM where available)', fields: [['revenue', 'Revenue', 'num'], ['grossProfit', 'Gross profit', 'num'], ['ebit', 'Operating profit (EBIT)', 'num'], ['netIncome', 'Net income', 'num'], ['da', 'Depreciation & amortization', 'num'], ['interestExpense', 'Interest expense', 'num'], ['epsTTM', 'EPS TTM, diluted ($)', 'num'], ['dividendsPaid', 'Dividends paid', 'num']] },
  { title: 'Balance sheet (most recent)', fields: [['cash', 'Cash & equivalents', 'num'], ['shortTermInvestments', 'Short-term investments', 'num'], ['totalCurrentAssets', 'Total current assets', 'num'], ['totalAssets', 'Total assets', 'num'], ['totalCurrentLiabilities', 'Total current liabilities', 'num'], ['longTermDebt', 'Long-term debt (non-current)', 'num'], ['totalDebt', 'Total debt (incl. current & short-term)', 'num'], ['totalLiabilities', 'Total liabilities', 'num'], ['goodwill', 'Goodwill', 'num'], ['intangibles', 'Intangible assets', 'num'], ['totalEquity', "Total shareholders' equity", 'num']] },
  { title: 'Cash flow (TTM where available)', fields: [['operatingCashFlow', 'Operating cash flow', 'num'], ['capex', 'Capex (purchases of PP&E)', 'num'], ['sbc', 'Share-based compensation', 'num']] },
  { title: 'Growth & returns', fields: [['revCAGR5', 'Revenue CAGR 5yr', 'pct'], ['epsCAGR5', 'EPS CAGR 5yr', 'pct'], ['epsCAGR10', 'EPS CAGR 10yr', 'pct'], ['fcfCAGR5', 'FCF CAGR 5yr', 'pct'], ['avgROE', 'Avg ROE (5yr)', 'pct'], ['avgROIC', 'ROIC (latest)', 'pct'], ['debtEquity', 'Debt / equity (reference figure — drives Buffett leverage score)', 'x'], ['grossMarginStdDev', 'Gross-margin std dev (stability)', 'pct']] },
  { title: 'Qualitative & history (0–5; 3 = neutral)', fields: [['yearsPositiveEarnings', 'Years of positive earnings (of last 10)', 'int'], ['yearsDividends', 'Years of dividends paid (of last 20)', 'int'], ['moat', 'Moat strength (0–5)', 'int'], ['management', 'Management quality (0–5)', 'int'], ['simplicity', 'Business simplicity (0–5)', 'int'], ['stability', 'Earnings stability (0 cyclical → 5 stable)', 'int'], ['accountingQuality', 'Accounting quality (0–5)', 'int']] },
  { title: 'Valuation assumptions', fields: [['expectedGrowth', 'Expected EPS growth, next 7–10yr', 'pct'], ['terminalGrowth', 'Terminal growth rate', 'pct'], ['discountRate', 'Discount rate / required return', 'pct'], ['aaaYield', 'AAA corporate bond yield (Graham Y)', 'pct'], ['treasury10y', '10yr Treasury yield (risk-free)', 'pct'], ['requiredMOS', 'Required margin of safety', 'pct']] },
];
const FIELD_KIND_OPTS = { num: {}, pct: { transform: 'pct', step: '0.1' }, int: { step: '1' }, x: { step: '0.01' }, text: { type: 'text', wide: true } };

function renderSources() {
  const group = AppState.assetType; const inp = AppState[group];
  let body = '';
  if (group === 'stock') {
    body = STOCK_FIELD_GROUPS.map(sec => `
      <div class="section-title">${esc(sec.title)}</div>
      <table class="ledger">${sec.fields.map(([field, label, kind]) => `<tr><td class="lbl">${label}${missHint('stock', field)}</td><td class="val">${srcDot('stock', field)}${efield('stock', field, inp[field], FIELD_KIND_OPTS[kind])}</td></tr>`).join('')}</table>`).join('');
    const v = computeValuation(inp);
    body += `<div class="section-title">Calculated (read-only)</div><table class="ledger">
      <tr><td class="lbl">Market cap</td><td class="val">${fmt.usd(v.marketCapV, { why: v.why.marketCapV })}</td></tr>
      <tr><td class="lbl">Free cash flow</td><td class="val">${fmt.usd(v.fcf, { why: v.why.fcf })}</td></tr>
    </table>`;
  } else {
    body = `<div class="section-title">All ${group} fields</div><p class="note-box">Edit these on the <b>${group === 'fund' ? 'Fund / ETF Detail' : 'Bond Detail'}</b> tab — they're shown together with their computed outputs there.</p>`;
  }
  const detail = AppState.sourceDetail[group] || {}; const srcMap = AppState.fieldSource[group] || {};
  const rows = Object.keys(srcMap).filter(f => srcMap[f] !== 'manual' || detail[f]).map(f => {
    const s = srcMap[f];
    const text = s === 'missing' ? `NOT AVAILABLE — ${inp.__why?.[f] || ''}` : detail[f] || SRC_LABEL[s];
    return `<tr><td class="field"><span class="src-dot ${s}"></span>${esc(FIELD_LABEL[f] || f)}</td><td class="source" style="${s === 'missing' ? 'color:var(--bad)' : ''}">${esc(text)}</td></tr>`;
  }).join('');
  return `
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>All inputs</h3><span class="card-note">${group}</span></div><div class="card-body">${body}</div></div>
    <div class="stack">
      <div class="card"><div class="card-head"><h3>Legend</h3></div><div class="card-body">
        ${['fetched', 'default', 'manual', 'missing'].map(s => `<div class="check-row"><span class="src-dot ${s}" style="margin-top:7px"></span><div class="cr-main"><div class="cr-title">${SRC_LABEL[s]}</div></div></div>`).join('')}
      </div></div>
      <div class="card"><div class="card-head"><h3>Source log</h3><span class="card-note">audit trail</span></div>
        <div class="card-body no-pad">${rows ? `<table class="data-table source-table"><tr><th>Field</th><th>Source</th></tr>${rows}</table>` : `<div class="empty-tab" style="padding:24px"><p>No fields logged yet.</p></div>`}</div>
      </div>
      <div class="note-box">Analyzed ${AppState.analyzedAt ? new Date(AppState.analyzedAt).toLocaleString() : '—'}. Re-run Analyze any time to refresh live fields — values you've typed in yourself (grey dot) are kept.</div>
    </div>
  </div>`;
}

/* ---------------- PRICE CHART (shared by stock / fund / bond summaries) ---------------- */
const CHART_RANGES = { '1Y': 1, '3Y': 3, '5Y': 5, '10Y': 10 };

function chartPoints() {
  const h = AppState.priceHistory; if (!h || h.length < 2) return null;
  const yrs = CHART_RANGES[AppState.chartRange] || 5;
  const last = h[h.length - 1][0];
  const cutoff = new Date(new Date(last).getTime() - yrs * 365.25 * DAY).toISOString().slice(0, 10);
  const pts = h.filter(p => p[0] >= cutoff);
  return pts.length >= 2 ? pts : h;
}

function priceChartCard() {
  const h = AppState.priceHistory;
  if (!h || h.length < 2) return `<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>Price history</h3></div><div class="card-body">${unav(AppState.priceHistoryWhy || 'no price history available')}</div></div>`;
  const pts = chartPoints();
  const first = pts[0], last = pts[pts.length - 1];
  const chg = last[1] / first[1] - 1;
  const spanYrs = dDays(last[0], first[0]) / 365.25;
  const label = spanYrs < (CHART_RANGES[AppState.chartRange] || 5) - 0.1 ? `since ${first[0]} (all history available)` : `over ${AppState.chartRange}`;
  const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  // Year-end closes as the accessible table view of the chart.
  const yearEnd = new Map(); for (const [d, c] of h) yearEnd.set(d.slice(0, 4), [d, c]);
  const rows = [...yearEnd.values()].reverse();
  return `<div class="card" style="margin-bottom:18px">
    <div class="card-head"><h3>Price history</h3>
      <div class="range-btns" role="group" aria-label="Chart range">${Object.keys(CHART_RANGES).map(r => `<button type="button" class="range-btn ${AppState.chartRange === r ? 'is-active' : ''}" data-range="${r}" aria-pressed="${AppState.chartRange === r}">${r}</button>`).join('')}</div>
    </div>
    <div class="card-body">
      <div class="pc-head"><span><b>${chg >= 0 ? '+' : ''}${(chg * 100).toFixed(1)}%</b> ${esc(label)}</span><span>range ${fmt.price(lo)} – ${fmt.price(hi)}</span></div>
      <div class="pc-wrap" id="priceChart" aria-label="Closing price, ${esc(first[0])} to ${esc(last[0])}, from ${fmt.price(first[1])} to ${fmt.price(last[1])}"></div>
      <p class="pc-note">Daily closing price (weekly before the last 12 months), not adjusted for dividends · Yahoo Finance. Hover or use ← → keys for values.</p>
      <details class="pc-table"><summary>Year-end closes (table view)</summary>
        <table class="data-table" style="margin-top:8px; max-width:360px"><tr><th>Last close of year</th><th class="num">Price</th></tr>
        ${rows.map(([d, c]) => `<tr><td>${esc(d)}</td><td class="num">${fmt.price(c)}</td></tr>`).join('')}</table>
      </details>
    </div>
  </div>`;
}

// Builds the SVG into #priceChart. Called after every render (and on resize / range change).
function mountPriceChart() {
  const wrap = document.getElementById('priceChart'); if (!wrap) return;
  const pts = chartPoints(); if (!pts) return;
  const W = Math.max(280, wrap.clientWidth), H = wrap.clientHeight || 240;
  const m = { t: 12, r: 64, b: 24, l: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const t0 = new Date(pts[0][0]).getTime(), t1 = new Date(pts[pts.length - 1][0]).getTime();
  let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  // Clean y ticks (1/2/2.5/5 × 10^n), ~4 intervals
  const raw = (hi - lo || hi || 1) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi === lo) hi = lo + step;
  const x = (d) => m.l + ((new Date(d).getTime() - t0) / (t1 - t0 || 1)) * iw;
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * ih;
  const yTicks = []; for (let v = lo; v <= hi + step / 2; v += step) yTicks.push(v);
  const dec = step < 1 ? 2 : 0;
  // x ticks: years (or quarters for a 1-year view)
  const spanYrs = (t1 - t0) / (365.25 * DAY);
  const xTicks = [];
  const d0 = new Date(t0);
  if (spanYrs <= 1.5) { for (let d = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); d.getTime() <= t1; d.setMonth(d.getMonth() + 3)) xTicks.push([d.toISOString().slice(0, 10), d.toLocaleString('en-US', { month: 'short' }) + (d.getMonth() === 0 ? ` ${d.getFullYear()}` : '')]); }
  else { const every = spanYrs > 6 ? 2 : 1; for (let yr = d0.getFullYear() + 1; new Date(`${yr}-01-01`).getTime() <= t1; yr += every) xTicks.push([`${yr}-01-01`, String(yr)]); }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${x(pts[pts.length - 1][0]).toFixed(1)},${(m.t + ih).toFixed(1)}L${m.l},${(m.t + ih).toFixed(1)}Z`;
  const last = pts[pts.length - 1];
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" tabindex="0" role="img" aria-label="${esc(wrap.getAttribute('aria-label'))}">
    ${yTicks.map(v => `<line class="pc-grid" x1="${m.l}" x2="${m.l + iw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="pc-axis" x="${m.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">$${v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}</text>`).join('')}
    ${xTicks.map(([d, l]) => `<text class="pc-axis" x="${x(d).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`).join('')}
    <path d="${area}" fill="var(--chart-area)"/>
    <path d="${line}" fill="none" stroke="var(--chart-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="4" fill="var(--chart-line)" stroke="var(--surface)" stroke-width="2"/>
    <text class="pc-axis" x="${(x(last[0]) + 9).toFixed(1)}" y="${(y(last[1]) + 4).toFixed(1)}" style="fill:var(--ink)">${fmt.price(last[1])}</text>
    <g class="pc-hover" visibility="hidden">
      <line class="pc-cross" y1="${m.t}" y2="${m.t + ih}" stroke="var(--ink-faint)" stroke-width="1"/>
      <circle class="pc-dot" r="4" fill="var(--chart-line)" stroke="var(--surface)" stroke-width="2"/>
    </g>
    <rect class="pc-hit" x="${m.l}" y="0" width="${iw}" height="${H}" fill="transparent"/>
  </svg><div class="pc-tip" hidden><div class="v"></div><div class="d"></div></div>`;

  const svg = wrap.querySelector('svg'), g = svg.querySelector('.pc-hover'), cross = svg.querySelector('.pc-cross'), dot = svg.querySelector('.pc-dot');
  const tip = wrap.querySelector('.pc-tip');
  const xs = pts.map(p => x(p[0]));
  let idx = pts.length - 1;
  const show = (i) => {
    idx = Math.max(0, Math.min(pts.length - 1, i));
    const px = xs[idx], py = y(pts[idx][1]);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); dot.setAttribute('cx', px); dot.setAttribute('cy', py);
    g.setAttribute('visibility', 'visible');
    const scale = wrap.clientWidth / W;
    tip.hidden = false;
    tip.querySelector('.v').textContent = fmt.plain(pts[idx][1]) === 'n/a' ? 'n/a' : `$${pts[idx][1].toFixed(2)}`;
    tip.querySelector('.d').textContent = new Date(pts[idx][0] + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half, Math.min(wrap.clientWidth - half, px * scale))}px`;
    tip.style.top = `${Math.max(0, py * scale - 54)}px`;
  };
  const hide = () => { g.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect(); const vx = (clientX - r.left) * (W / r.width);
    let lo2 = 0, hi2 = xs.length - 1; while (hi2 - lo2 > 1) { const mid = (lo2 + hi2) >> 1; if (xs[mid] < vx) lo2 = mid; else hi2 = mid; }
    return Math.abs(xs[lo2] - vx) <= Math.abs(xs[hi2] - vx) ? lo2 : hi2;
  };
  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(idx));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    const stepN = e.shiftKey ? 20 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - stepN); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + stepN); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(pts.length - 1); }
    else if (e.key === 'Escape') hide();
  });
}

/* ---------------- FINANCIALS (stock) ---------------- */
function renderFinancials() {
  const inp = AppState.stock; const h = inp.history;
  if (!h || !h.length) return `<div class="empty-tab"><h3>No financial history</h3><p>${esc(inp.__why?.revenue || 'SEC EDGAR returned no annual statements for this company.')}</p></div>`;
  const NR = '<span class="nr" title="not reported in this year\'s XBRL filing">n/r</span>';
  const money = (v) => (ok(v) ? `<span${v < 0 ? ' class="neg"' : ''}>${fmt.usd(v)}</span>` : NR);
  const pctv = (v) => (ok(v) ? fmt.pct(v, 1) : NR);
  const cols = [
    ['Revenue', r => money(r.revenue)],
    ['Gross margin', r => pctv(ok(r.grossProfit) && r.revenue > 0 ? r.grossProfit / r.revenue : null) + (r.grossProfitDerived ? '<sup>‡</sup>' : '')],
    ['Operating income', r => money(r.ebit) + (r.ebitDerived && ok(r.ebit) ? '<sup>†</sup>' : '')],
    ['Net income', r => money(r.netIncome)],
    ['Net margin', r => pctv(ok(r.netIncome) && r.revenue > 0 ? r.netIncome / r.revenue : null)],
    ['Diluted EPS', r => (ok(r.eps) ? `<span${r.eps < 0 ? ' class="neg"' : ''}>${fmt.price(r.eps)}</span>` : NR)],
    ['Operating cash flow', r => money(r.ocf)],
    ['Capex', r => money(r.capex)],
    ['Free cash flow', r => money(r.fcf)],
    ["Equity (year-end)", r => money(r.equity)],
    ['ROE', r => pctv(r.roe)],
    ['Dividends paid', r => money(r.dividends)],
  ];
  const anyDerivedEbit = h.some(r => r.ebitDerived), anyDerivedGp = h.some(r => r.grossProfitDerived);
  const fyLabel = (r) => (r.ttm ? `TTM to ${r.end}` : `FY ${r.end}`);
  return `
  <div class="card"><div class="card-head"><h3>Annual financial history</h3><span class="card-note">SEC EDGAR 10-K filings · most recent first</span></div>
    <div class="card-body no-pad">
      <table class="data-table fin-table">
        <tr><th>Period</th>${cols.map(c => `<th class="num">${c[0]}</th>`).join('')}</tr>
        ${h.map(r => `<tr class="${r.ttm ? 'ttm' : ''}"><td>${esc(fyLabel(r))}</td>${cols.map(c => `<td class="num">${c[1](r)}</td>`).join('')}</tr>`).join('')}
      </table>
    </div>
  </div>
  <p class="note-box" style="margin-top:14px">Each row is one fiscal year as reported in the company's 10-K, keyed by the fiscal year-end date (the TTM row adds the latest 10-Q quarters). EPS is rescaled for stock splits so years are comparable. <b>n/r</b> = not reported in that year's machine-readable (XBRL) filing — not zero.${anyDerivedEbit ? ' <b>†</b> No operating-income line is reported, so this is pre-tax income plus interest expense.' : ''}${anyDerivedGp ? ' <b>‡</b> Derived as revenue minus cost of revenue.' : ''} ROE here is net income ÷ year-end equity.</p>`;
}
