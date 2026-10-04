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
