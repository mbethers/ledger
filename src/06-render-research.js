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
