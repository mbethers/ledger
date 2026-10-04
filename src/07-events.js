
/* ============================================================================
   PART 8 — EVENT WIRING + INIT
   FIX: the original Analyze button was a <form> submit button. Inside a sandboxed
   frame (e.g. an artifact viewer without allow-forms) the browser blocks form
   submission, so the submit handler never fired — while the example chips, which
   use plain click handlers, worked. Everything is now plain click/keydown handlers.
   ============================================================================ */

function setAssetType(type) {
  document.querySelectorAll('.asset-btn').forEach(b => b.classList.toggle('is-active', b.dataset.asset === type));
  AppState.selectedType = type; // only the NEXT analysis; the current report keeps its own type
}

function runFromInput() {
  const input = document.getElementById('tickerInput');
  const raw = input.value;
  if (!raw.trim()) { input.focus(); return; }
  analyzeTicker(raw, AppState.selectedType);
}

document.querySelectorAll('.asset-btn').forEach(btn => btn.addEventListener('click', () => setAssetType(btn.dataset.asset)));
document.getElementById('analyzeBtn').addEventListener('click', runFromInput);
document.getElementById('tickerInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); runFromInput(); }
});

document.querySelectorAll('[data-example]').forEach(btn => btn.addEventListener('click', () => {
  const [type, ticker] = btn.dataset.example.split(':');
  setAssetType(type);
  document.getElementById('tickerInput').value = ticker;
  analyzeTicker(ticker, type);
}));

// Delegated handlers (set once — not re-bound on every render).
document.getElementById('tabContent').addEventListener('click', (e) => {
  const b = e.target.closest('.range-btn');
  if (b) { AppState.chartRange = b.dataset.range; renderApp(); return; }
  // Switch the valuation between reported, core (ex non-operating) and normalized (cyclical) earnings.
  const a = e.target.closest('[data-action="core-earnings"], [data-action="reported-earnings"], [data-action="normalized-earnings"]');
  const s = AppState.stock;
  if (!a || !s) return;
  const basis = a.dataset.action.replace('-earnings', '');
  setEarningsBasis(s, AppState.fieldSource.stock, AppState.sourceDetail.stock, basis);
  s.earningsBasisChoice = basis;
  recompute();
});
let resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { try { mountPriceChart(); } catch (e) { /* chart is optional */ } }, 150); });
document.getElementById('tabNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn'); if (btn) setActiveTab(btn.dataset.tab);
});
document.getElementById('fetchStatus').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (a === 'hide-log') document.getElementById('fetchStatus').hidden = true;
  else if (a === 'expand-log' || a === 'collapse-log') { AppState.logCollapsed = a === 'collapse-log'; renderFetchStatus(); }
});
document.getElementById('watchlistStrip').addEventListener('click', async (e) => {
  const chip = e.target.closest('.wl-chip'); if (!chip || AppState.busy) return;
  const t = chip.dataset.wl, at = chip.dataset.wat;
  setAssetType(at);
  document.getElementById('tickerInput').value = t;
  if (await loadProfile(t)) {
    document.getElementById('emptyState').hidden = true; document.getElementById('mainApp').hidden = false;
    document.getElementById('fetchStatus').hidden = true;
    AppState.activeTab = 'summary'; renderApp(); renderWatchlist();
  } else analyzeTicker(t, at);
});

// Editable-field changes. Numbers: a cleared field becomes "missing" (null), never 0.
document.getElementById('tabContent').addEventListener('change', (e) => {
  const t = e.target;
  if (!t.classList.contains('efield')) return;
  const group = t.dataset.group, field = t.dataset.field, transform = t.dataset.transform;
  if (!AppState[group]) return;
  const srcMap = AppState.fieldSource[group] || (AppState.fieldSource[group] = {});
  if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.type === 'text') {
    AppState[group][field] = t.value; srcMap[field] = 'manual';
  } else {
    let v = t.value.trim() === '' ? null : parseFloat(t.value);
    if (v != null && !Number.isFinite(v)) v = null;
    if (v != null && transform === 'pct') v = v / 100;
    AppState[group][field] = v;
    srcMap[field] = v == null ? 'missing' : 'manual';
    const why = AppState[group].__why || (AppState[group].__why = {});
    if (v == null) why[field] = 'cleared by you'; else delete why[field];
    // A hand-entered history count replaces the SEC-derived one, so drop its "of N years" context.
    if (field === 'yearsDividends') delete AppState[group].yearsDividendsOf;
    if (field === 'yearsPositiveEarnings') delete AppState[group].yearsPositiveEarningsOf;
    if (field === 'epsCAGR5') delete AppState[group].epsCAGR5Neg;
    if (field === 'revCAGR5') delete AppState[group].revCAGR5Neg;
    // Typing EPS or net income by hand overrides any core/normalized basis.
    if (field === 'epsTTM' || field === 'netIncome') { const g = AppState[group]; g.coreEarningsApplied = g.normalizedEarningsApplied = false; delete g.earningsBasisChoice; }
  }
  recompute();
});
document.getElementById('tabContent').addEventListener('input', (e) => {
  const t = e.target;
  if (!(t.tagName === 'TEXTAREA' && t.classList.contains('efield'))) return;
  const group = t.dataset.group, field = t.dataset.field;
  if (AppState[group]) { AppState[group][field] = t.value; saveProfile(AppState.ticker); }
});

// ---- Optional data-keys panel ----
function renderKeyState() {
  const has = { av: !!Keys.get('av'), td: !!Keys.get('td') };
  const mask = (k) => (k.length > 4 ? `saved · ends …${k.slice(-4)}` : 'saved');
  document.getElementById('avState').textContent = has.av ? mask(Keys.get('av')) : 'not set';
  document.getElementById('tdState').textContent = has.td ? mask(Keys.get('td')) : 'not set';
  document.getElementById('avState').classList.toggle('set', has.av);
  document.getElementById('tdState').classList.toggle('set', has.td);
  document.getElementById('keysBtn').classList.toggle('has-keys', has.av || has.td);
}
document.getElementById('keysBtn').addEventListener('click', () => {
  const panel = document.getElementById('keysPanel'); panel.hidden = !panel.hidden;
  document.getElementById('keysBtn').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) { document.getElementById('avKey').value = Keys.get('av'); document.getElementById('tdKey').value = Keys.get('td'); }
});
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
document.getElementById('keysShow').addEventListener('click', (e) => {
  const inputs = [document.getElementById('avKey'), document.getElementById('tdKey')];
  const show = inputs[0].type === 'password';
  inputs.forEach(i => { i.type = show ? 'text' : 'password'; });
  e.target.textContent = show ? 'Hide' : 'Show';
});
document.getElementById('keysSave').addEventListener('click', async () => {
  await Keys.set(document.getElementById('avKey').value, document.getElementById('tdKey').value);
  renderKeyState();
  document.getElementById('keysPanel').hidden = true; document.getElementById('keysBtn').setAttribute('aria-expanded', 'false');
  Fetcher.reset(); document.getElementById('fetchStatus').hidden = false;
  Fetcher.note('ok', `Keys saved in this browser (${[Keys.get('av') && 'Alpha Vantage', Keys.get('td') && 'Twelve Data'].filter(Boolean).join(' + ') || 'none'}). Click Analyze to use them.`);
});
document.getElementById('keysClear').addEventListener('click', async () => {
  await Keys.set('', '');
  document.getElementById('avKey').value = ''; document.getElementById('tdKey').value = '';
  renderKeyState();
});
['avKey', 'tdKey'].forEach(id => document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('keysSave').click(); } }));

async function init() {
  await Keys.load(); renderKeyState();
  const settings = await Store.get('settings');
  if (settings?.watchlist?.length) { AppState.watchlist = settings.watchlist; renderWatchlist(); }
  if (settings?.lastTicker && await loadProfile(settings.lastTicker)) {
    setAssetType(AppState.assetType);
    document.getElementById('tickerInput').value = settings.lastTicker;
    document.getElementById('emptyState').hidden = true; document.getElementById('mainApp').hidden = false;
    AppState.activeTab = 'summary'; renderApp(); renderWatchlist();
  }
}
init();
