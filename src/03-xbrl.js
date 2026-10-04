// ---- XBRL extraction (keyed by reporting PERIOD, not by the filing's fiscal-year tag) ----
// The companyfacts `fy` field is the fiscal year of the *filing* a number appeared in; every
// 10-K also repeats 2-3 prior years of comparatives under that same fy. So all period logic
// here keys on the fact's own start/end dates.
const DAY = 86400000;
const dDays = (a, b) => (new Date(a) - new Date(b)) / DAY;
const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '10-KT', '20-F', '20-F/A', '40-F', '40-F/A']);
const QUARTER_FORMS = new Set(['10-Q', '10-Q/A']);

const XBRL = {
  splits: [], // detected stock splits for the current company: [{ before, factor }]

  // Stock splits: filings made after a split restate prior periods' per-share figures, but
  // periods that were never re-reported keep pre-split values — which wrecks multi-year EPS
  // growth (AAPL's 10-yr EPS CAGR reads negative across its 2020 4:1 split). Detect each split
  // from a period reported at two different scales, then rescale everything filed before it.
  // Works for any taxonomy/currency: callers pass the EPS and share-count tags of the filer's standard.
  detectSplits(facts, { taxonomy = 'us-gaap', perShareUnit = 'USD/shares',
    epsTags = ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
    shareTags = ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic'] } = {}) {
    this.splitTaxonomy = taxonomy;
    const tax = facts?.facts?.[taxonomy] || {};
    const pts = [];
    for (const t of epsTags) for (const p of tax[t]?.units?.[perShareUnit] || []) pts.push({ ...p, tag: t });
    const groups = new Map();
    for (const p of pts) { if (!p.val) continue; const k = `${p.tag}|${p.start}|${p.end}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    // Share counts for the same period, by filing date — a genuine split rescales these too,
    // which separates real splits from earnings restatements and one-off tagging errors.
    const shareByPeriod = new Map();
    for (const t of shareTags)
      for (const p of tax[t]?.units?.shares || []) { const k = `${p.start}|${p.end}`; if (!shareByPeriod.has(k)) shareByPeriod.set(k, []); shareByPeriod.get(k).push(p); }
    const sharesConfirm = (start, end, earlyFiled, lateFiled, r) => {
      const s = shareByPeriod.get(`${start}|${end}`) || [];
      const early = s.filter(p => p.filed <= earlyFiled), late = s.filter(p => p.filed >= lateFiled);
      return early.some(e => late.some(l => e.val > 0 && Math.abs((l.val / e.val) / r - 1) < 0.05));
    };
    // Real splits use clean ratios. Snapping to these rejects restatement noise (and makes
    // NKE's measured "1.99" an exact 2).
    const CLEAN = [1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];
    const snap = (r) => {
      const cands = r >= 1 ? CLEAN : CLEAN.map(c => 1 / c);
      const best = cands.reduce((b, c) => (Math.abs(r / c - 1) < Math.abs(r / b - 1) ? c : b));
      return Math.abs(r / best - 1) <= 0.03 ? best : null;
    };
    const events = [];
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => (a.filed < b.filed ? -1 : 1));
      for (let i = 1; i < g.length; i++) {
        // EPS is reported to the cent, so tiny values give meaningless ratios (TSLA's $0.09 → $0.02
        // read as a "4.5x split"). Only compare figures large enough for rounding not to matter.
        if (Math.abs(g[i].val) < 0.25 || Math.abs(g[i - 1].val) < 0.25) continue;
        const r = g[i - 1].val / g[i].val;
        if (!(r > 1.2 || (r > 0 && r < 0.83))) continue; // ordinary restatements move EPS by a few %
        const factor = snap(r); if (!factor) continue;
        const before = g[i - 1].filed, after = g[i].filed;
        const confirmed = sharesConfirm(g[i].start, g[i].end, before, after, factor);
        // The same split is seen from many periods (annual + quarterly comparatives); merge
        // detections whose (last pre-split filing, first restated filing] windows overlap.
        const ev = events.find(e => e.factor === factor && before < e.after && e.before < after);
        if (ev) { if (before > ev.before) ev.before = before; if (after < ev.after) ev.after = after; ev.confirmed ||= confirmed; ev.periods.add(`${g[i].start}|${g[i].end}`); }
        else events.push({ before, after, factor, confirmed, periods: new Set([`${g[i].start}|${g[i].end}`]) });
      }
    }
    // Keep a split when share counts confirm it, or — for companies like Alphabet that report share
    // counts only per share class — when at least two separate periods show the same clean ratio.
    this.splits = events.filter(e => e.confirmed || e.periods.size >= 2).map(({ before, after, factor }) => ({ before, after, factor }));
    return this.splits;
  },
  // Factor that converts a per-share value filed on `filed` into today's share basis.
  splitFactor(filed) { let f = 1; for (const e of this.splits) if (filed <= e.before) f *= e.factor; return f; },

  tagPoints(facts, tags, unit = 'USD', taxonomy = 'us-gaap') {
    const tax = facts?.facts?.[taxonomy] || {};
    const out = [];
    tags.forEach((tag, pri) => {
      const pts = tax[tag]?.units?.[unit];
      if (!pts) return;
      for (const p of pts) {
        let val = p.val;
        if (this.splits.length && unit.endsWith('/shares')) val = val / this.splitFactor(p.filed);
        else if (this.splits.length && unit === 'shares' && taxonomy === this.splitTaxonomy) val = val * this.splitFactor(p.filed);
        out.push({ ...p, val, tag, pri });
      }
    });
    return out;
  },
  // Lower priority index wins; within a tag, the most recently filed value wins (restatements).
  better(a, b) { return !b || a.pri < b.pri || (a.pri === b.pri && a.filed > b.filed); },
  isFullYear(p) { if (!p.start) return false; const d = dDays(p.end, p.start); return d >= 340 && d <= 380; },

  // One value per fiscal year-end, merged across alias tags.
  annual(facts, tags, { instant = false, unit = 'USD', taxonomy = 'us-gaap' } = {}) {
    const byEnd = new Map();
    for (const p of this.tagPoints(facts, tags, unit, taxonomy)) {
      if (!ANNUAL_FORMS.has(p.form)) continue;
      if (instant ? p.start : !this.isFullYear(p)) continue;
      if (this.better(p, byEnd.get(p.end))) byEnd.set(p.end, p);
    }
    return [...byEnd.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
  },

  // Most recent balance-sheet value from any 10-K or 10-Q.
  instantAt(facts, tags, date, { unit = 'USD', taxonomy = 'us-gaap' } = {}) {
    let best = null;
    for (const p of this.tagPoints(facts, tags, unit, taxonomy)) {
      if (p.start || p.end !== date) continue;
      if (this.better(p, best)) best = p;
    }
    return best;
  },
  latestInstant(facts, tags, { unit = 'USD', taxonomy = 'us-gaap' } = {}) {
    let best = null;
    for (const p of this.tagPoints(facts, tags, unit, taxonomy)) {
      if (p.start) continue;
      if (!(ANNUAL_FORMS.has(p.form) || QUARTER_FORMS.has(p.form))) continue;
      if (!best || p.end > best.end || (p.end === best.end && this.better(p, best))) best = p;
    }
    return best;
  },

  // Trailing-twelve-months for a flow concept: latest FY + current YTD − prior-year YTD,
  // computed within a single tag so the three pieces are consistent. Falls back to the
  // latest full fiscal year when no later 10-Q exists.
  ttm(facts, tags, { unit = 'USD', taxonomy = 'us-gaap' } = {}) {
    const merged = this.annual(facts, tags, { unit, taxonomy });
    if (!merged.length) return null;
    const fy = merged[merged.length - 1];
    let best = { val: fy.val, end: fy.end, basis: 'FY', tag: fy.tag, fyEnd: fy.end, series: merged };
    tags.forEach(tag => {
      const pts = this.tagPoints(facts, [tag], unit, taxonomy);
      const ann = pts.filter(p => ANNUAL_FORMS.has(p.form) && this.isFullYear(p) && p.end === fy.end);
      if (!ann.length) return;
      const a = ann.reduce((x, y) => (y.filed > x.filed ? y : x));
      // YTD points that begin the day after the fiscal year ended
      const ytds = pts.filter(p => QUARTER_FORMS.has(p.form) && p.start && p.end > fy.end && Math.abs(dDays(p.start, fy.end) - 1) <= 7);
      if (!ytds.length) return;
      const cur = ytds.reduce((x, y) => (y.end > x.end || (y.end === x.end && y.filed > x.filed) ? y : x));
      const len = dDays(cur.end, cur.start);
      const priors = pts.filter(p => p.start && Math.abs(dDays(cur.end, p.end) - 365) <= 10 && Math.abs(dDays(p.end, p.start) - len) <= 10);
      if (!priors.length) return;
      const prior = priors.reduce((x, y) => (y.filed > x.filed ? y : x));
      const cand = { val: a.val + cur.val - prior.val, end: cur.end, basis: 'TTM', tag, fyEnd: fy.end, series: merged };
      if (cand.end > best.end) best = cand;
    });
    return best;
  },

  // CAGR between the latest annual point and the point closest to N years earlier.
  cagr(series, years) {
    if (!series || series.length < 2) return { val: null, why: 'fewer than 2 fiscal years of data' };
    const last = series[series.length - 1];
    let start = null, bestDiff = Infinity;
    for (const p of series) { const diff = Math.abs(dDays(last.end, p.end) - years * 365.25); if (diff < bestDiff) { bestDiff = diff; start = p; } }
    if (!start || start === last || bestDiff > 120) return { val: null, why: `no fiscal year ≈${years} years before ${last.end}` };
    const yrs = dDays(last.end, start.end) / 365.25;
    if (start.val <= 0) return { val: null, neg: true, why: `starting value (FY ${start.end}) is ≤ 0 — growth rate undefined` };
    if (last.val <= 0) return { val: null, neg: true, why: `latest value (FY ${last.end}) is ≤ 0 — growth rate undefined` };
    return { val: Math.pow(last.val / start.val, 1 / yrs) - 1, from: start.end, to: last.end };
  },
};

if (typeof module !== 'undefined') module.exports = { XBRL, dDays };
