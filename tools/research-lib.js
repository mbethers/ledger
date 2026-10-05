// Node-only helpers for research portfolios: integrity fingerprint, validation, storage, Yahoo prices.
// The app never needs these; the build, record/check-in scripts and tests do.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const RESEARCH_FILE = path.join(ROOT, 'research', 'portfolios.json');
const CONFIG_FILE = path.join(ROOT, 'research', 'config.json');
const TYPES = new Set(['stock', 'etf', 'adr', 'bond-fund']);
const STATUSES = new Set(['intact', 'weakened', 'broken']);
const THESIS = ['pricedIn', 'consensus', 'variant', 'catalyst', 'killCriteria'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Everything that must never change after creation, including each thesis and theme.
// Check-ins and the research log are excluded.
function fingerprint(p) {
  const pos = Array.isArray(p.positions) ? p.positions : [];
  const core = { id: p.id, entryDate: p.entryDate, horizonYears: p.horizonYears, benchmark: p.benchmark, benchmarkEntry: p.benchmarkEntry,
    cashWeight: p.cashWeight, positions: pos.map(x => (x && typeof x === 'object' ? [x.ticker, x.type, x.weight, x.entryPrice, x.theme, x.thesis] : x)),
    avoid: (Array.isArray(p.avoid) ? p.avoid : []).map(a => (a && typeof a === 'object' ? [a.ticker, a.type, a.reason, a.entryPrice] : a)) };
  return crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
}

function validatePortfolio(p) {
  const e = [];
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!str(p.id)) e.push('id missing');
  if (!str(p.createdAt)) e.push('createdAt missing');
  if (!Number.isInteger(p.horizonYears) || p.horizonYears < 1 || p.horizonYears > 5) e.push('horizonYears must be an integer 1–5');
  if (!ISO.test(p.entryDate || '')) e.push('entryDate must be YYYY-MM-DD');
  if (p.benchmark !== '^SP500TR') e.push('benchmark must be ^SP500TR');
  if (!(p.benchmarkEntry > 0)) e.push('benchmarkEntry must be > 0');
  if (!Array.isArray(p.positions)) e.push('positions must be an array');
  const all = Array.isArray(p.positions) ? p.positions : [];
  if (all.some(x => !x || typeof x !== 'object' || Array.isArray(x))) e.push('every position must be an object');
  const pos = all.filter(x => x && typeof x === 'object' && !Array.isArray(x));
  if (all.length < 10 || all.length > 20) e.push(`needs 10–20 positions (has ${all.length})`);
  const seen = new Set(), themes = {};
  for (const x of pos) {
    const t = x.ticker || '?';
    if (!/^[A-Z0-9.\-^]{1,12}$/.test(t)) e.push(`${t}: bad ticker`);
    if (seen.has(t)) e.push(`${t}: duplicate ticker`); seen.add(t);
    if (!TYPES.has(x.type)) e.push(`${t}: type must be one of ${[...TYPES].join(', ')}`);
    if (!(x.weight > 0 && x.weight <= 0.15 + 1e-9)) e.push(`${t}: weight must be > 0 and ≤ 15%`);
    if (!(x.entryPrice > 0)) e.push(`${t}: entryPrice must be > 0`);
    if (!str(x.theme)) e.push(`${t}: theme missing`); else themes[x.theme] = (themes[x.theme] || 0) + (x.weight || 0);
    for (const f of THESIS) if (!str(x.thesis?.[f])) e.push(`${t}: thesis.${f} missing`);
    if (!Array.isArray(x.sources)) e.push(`${t}: sources must be an array`);
    else if (x.sources.some(u => typeof u !== 'string' || !/^https?:\/\//i.test(u))) e.push(`${t}: every source must be an http(s) URL`);
  }
  for (const [th, w] of Object.entries(themes)) if (w > 0.35 + 1e-9) e.push(`theme ${th} is ${(w * 100).toFixed(1)}% (max 35%)`);
  const cash = p.cashWeight;
  if (!(cash >= 0 && cash <= 1)) e.push('cashWeight must be 0–1');
  const sum = pos.reduce((s, x) => s + (x.weight || 0), 0) + (cash || 0);
  if (Math.abs(sum - 1) > 0.001) e.push(`weights + cash sum to ${sum.toFixed(4)}, must be 1`);
  // Avoid list (optional): negative calls, frozen at creation like the positions.
  if (p.avoid !== undefined) {
    if (!Array.isArray(p.avoid)) e.push('avoid must be an array');
    else {
      const avoided = new Set();
      for (const a of p.avoid) {
        if (!a || typeof a !== 'object') { e.push('every avoid entry must be an object'); continue; }
        const t = a.ticker || '?';
        if (!/^[A-Z0-9.\-^]{1,12}$/.test(t)) e.push(`avoid ${t}: bad ticker`);
        if (avoided.has(t)) e.push(`avoid ${t}: duplicate ticker`); avoided.add(t);
        if (seen.has(t)) e.push(`${t} is both held and on the avoid list`);
        if (!TYPES.has(a.type)) e.push(`avoid ${t}: type must be one of ${[...TYPES].join(', ')}`);
        if (!str(a.reason)) e.push(`avoid ${t}: reason missing`);
        if (!(a.entryPrice > 0)) e.push(`avoid ${t}: entryPrice must be > 0`);
      }
    }
  }
  let prev = null;
  for (const ci of p.checkIns || []) {
    if (!ISO.test(ci.date || '')) { e.push('check-in date must be YYYY-MM-DD'); continue; }
    if (ci.date < p.entryDate) e.push(`check-in ${ci.date} is before entry`);
    if (prev && ci.date < prev) e.push(`check-in ${ci.date} is out of order (after ${prev})`);
    prev = ci.date;
    for (const c of ci.positions || []) {
      if (!seen.has(c.ticker)) e.push(`check-in ${ci.date}: ${c.ticker} is not a position`);
      if (!STATUSES.has(c.status)) e.push(`check-in ${ci.date}: ${c.ticker} status must be intact, weakened or broken`);
      if (c.exitPrice != null && !(c.exitPrice > 0)) e.push(`check-in ${ci.date}: ${c.ticker} exitPrice must be > 0`);
    }
  }
  if (p.fingerprint !== fingerprint(p)) e.push('fingerprint mismatch — positions, weights, prices or dates were edited after creation');
  return e;
}

function validateAll(list) {
  const e = [], ids = new Set();
  for (const p of list) {
    if (ids.has(p.id)) e.push(`duplicate id ${p.id}`); ids.add(p.id);
    for (const msg of validatePortfolio(p)) e.push(`${p.id}: ${msg}`);
  }
  for (const p of list) if (p.derivedFrom != null && !ids.has(p.derivedFrom)) e.push(`${p.id}: derivedFrom ${p.derivedFrom} not found`);
  return e;
}

function loadPortfolios() { return fs.existsSync(RESEARCH_FILE) ? JSON.parse(fs.readFileSync(RESEARCH_FILE, 'utf8')) : []; }
function savePortfolios(list) { fs.mkdirSync(path.dirname(RESEARCH_FILE), { recursive: true }); fs.writeFileSync(RESEARCH_FILE, JSON.stringify(list, null, 2) + '\n'); }

// Daily closes + adjusted closes from fromISO to today, straight from Yahoo (Node has no CORS limits).
async function yahooSeries(symbol, fromISO) {
  const p1 = Math.floor(new Date(fromISO).getTime() / 1000) - 7 * 86400, p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const r = (await res.json())?.chart?.result?.[0];
      if (!r?.timestamp) throw new Error(`no Yahoo data for ${symbol}`);
      const q = r.indicators.quote[0], adj = r.indicators.adjclose?.[0]?.adjclose || [];
      const rows = r.timestamp.map((t, k) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: q.close[k], adj: adj[k] ?? q.close[k] })).filter(x => x.close != null);
      return { rows, meta: r.meta };
    }
    await new Promise(ok => setTimeout(ok, 1500 * (i + 1)));
  }
  throw new Error(`Yahoo request failed for ${symbol}`);
}

module.exports = { fingerprint, validatePortfolio, validateAll, loadPortfolios, savePortfolios, yahooSeries, RESEARCH_FILE, CONFIG_FILE, ROOT };
