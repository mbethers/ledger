/* ============================================================================
   PART 2b — RESEARCH PORTFOLIOS: data slot + scoring (pure; shared with tools/)
   Portfolios are researched in Claude Code and stored in research/portfolios.json (git-ignored).
   tools/build.js --private inlines them below; the public build always ships an empty array.
   ============================================================================ */

const RESEARCH_DATA = /*RESEARCH_DATA*/[]/*END_RESEARCH_DATA*/;

function horizonEnd(entryDate, horizonYears) {
  return `${+entryDate.slice(0, 4) + horizonYears}${entryDate.slice(4)}`;
}

// Latest point on or before `date` in an ascending [{date, adj}] series.
function pointOnOrBefore(rows, date) {
  let best = null;
  for (const r of rows) { if (r.date > date) break; best = r; }
  return best;
}

// Buy-and-hold score: weights drift with prices, dividends via adjusted close, cash at 0%,
// frozen at entryDate + horizon. A holding with no usable series makes the total unavailable.
function scorePortfolio(p, series, asOf) {
  const end = horizonEnd(p.entryDate, p.horizonYears);
  const endDate = asOf < end ? asOf : end;
  // Status comes from the latest check-in that mentions a ticker; an exit is the EARLIEST entry with a
  // valid exitPrice and is sticky (later check-ins never cancel or move it).
  const latest = {}, exits = {};
  for (const ci of p.checkIns || []) for (const e of ci.positions || []) {
    latest[e.ticker] = { ...e, date: ci.date };
    if (!exits[e.ticker] && ok(e.exitPrice)) exits[e.ticker] = { ...e, date: ci.date };
  }
  const exitOf = (t) => exits[t] || null;

  const bench = (series[p.benchmark] || []).filter(r => r.date >= p.entryDate && r.date <= endDate);
  const positions = p.positions.map(x => ({ ticker: x.ticker, type: x.type, weight: x.weight, theme: x.theme, entryPrice: x.entryPrice,
    ret: null, contribution: null, exited: !!exitOf(x.ticker), approx: false, why: null, status: latest[x.ticker]?.status ?? null }));
  const base = { endDate, matured: asOf >= end, days: Math.round(dDaysISO(endDate, p.entryDate)), approx: false, positions, avoid: null };

  const b0 = pointOnOrBefore(series[p.benchmark] || [], p.entryDate);
  if (!b0 || !bench.length) return { ...base, total: null, why: `benchmark ${p.benchmark} prices unavailable`, curve: [], avoid: null };
  base.avoid = scoreAvoid(p, series, endDate, b0, bench[bench.length - 1]);

  // Per-position value multiple on each benchmark date (1 = entry).
  const missing = [];
  const valueFns = p.positions.map((x, i) => {
    const rows = series[x.ticker], ex = exitOf(x.ticker), pos = positions[i];
    const start = rows && pointOnOrBefore(rows, p.entryDate);
    if (!start) {
      if (ex) { pos.approx = true; const m = ex.exitPrice / x.entryPrice; return (d) => (d >= ex.date ? m : 1); }
      pos.why = 'price history unavailable'; missing.push(x.ticker); return null;
    }
    if (ex) {
      const atExit = pointOnOrBefore(rows, ex.date); const mExit = atExit ? atExit.adj / start.adj : ex.exitPrice / x.entryPrice;
      return (d) => (d >= ex.date ? mExit : (pointOnOrBefore(rows, d) || start).adj / start.adj);
    }
    return (d) => (pointOnOrBefore(rows, d) || start).adj / start.adj;
  });
  base.approx = positions.some(x => x.approx);
  if (missing.length) return { ...base, total: null, why: `price unavailable for ${missing.join(', ')}`, curve: [] };

  const cash = p.cashWeight || 0;
  const curve = bench.map(r => {
    const v = cash + p.positions.reduce((s, x, i) => s + x.weight * valueFns[i](r.date), 0);
    return [r.date, v * 100000, (r.adj / b0.adj) * 100000];
  });
  const last = curve[curve.length - 1];
  positions.forEach((pos, i) => { const m = valueFns[i](last[0]); pos.ret = m - 1; pos.contribution = pos.weight * (m - 1); });

  const ret = last[1] / 100000 - 1, benchRet = last[2] / 100000 - 1;
  const ann = base.days >= 365 ? (r) => Math.pow(1 + r, 365.25 / base.days) - 1 : () => null;
  return { ...base, why: null, curve,
    total: { ret, benchRet, excess: ret - benchRet, maxDrawdown: maxDrawdown(curve.map(c => c[1])), benchMaxDrawdown: maxDrawdown(curve.map(c => c[2])),
      vol: annualVol(curve.map(c => c[1])), benchVol: annualVol(curve.map(c => c[2])), annRet: ann(ret), annBench: ann(benchRet) } };
}

// The avoid list: negative calls made at creation. Each name is measured from the entry date to the
// score date against the benchmark; a call is a hit when the stock lagged. The basket is equal-weight
// and, like the portfolio total, unavailable (never zero-filled) if any name lacks price history.
function scoreAvoid(p, series, endDate, b0, bEnd) {
  if (!Array.isArray(p.avoid) || !p.avoid.length) return null;
  const benchRet = bEnd.adj / b0.adj - 1;
  const rows = p.avoid.map(a => {
    const r = series[a.ticker], start = r && pointOnOrBefore(r, p.entryDate), end = r && pointOnOrBefore(r, endDate);
    const row = { ticker: a.ticker, type: a.type, reason: a.reason, entryPrice: a.entryPrice, ret: null, vsBench: null, hit: null, why: null };
    if (!start || !end) { row.why = 'price history unavailable'; return row; }
    row.ret = end.adj / start.adj - 1; row.vsBench = row.ret - benchRet; row.hit = row.vsBench < 0;
    return row;
  });
  const scoredRows = rows.filter(r => r.ret != null), missing = rows.filter(r => r.ret == null).map(r => r.ticker);
  return { rows, benchRet, scored: scoredRows.length, hits: scoredRows.filter(r => r.hit).length,
    basketRet: missing.length ? null : scoredRows.reduce((s, r) => s + r.ret, 0) / scoredRows.length,
    why: missing.length ? `price unavailable for ${missing.join(', ')}` : null };
}

function maxDrawdown(vals) {
  let peak = -Infinity, dd = 0;
  for (const v of vals) { peak = Math.max(peak, v); dd = Math.max(dd, 1 - v / peak); }
  return dd;
}
function annualVol(vals) {
  if (vals.length < 3) return 0;
  const r = []; for (let i = 1; i < vals.length; i++) r.push(vals[i] / vals[i - 1] - 1);
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252);
}
function dDaysISO(a, b) { return (new Date(a) - new Date(b)) / 86400000; }
