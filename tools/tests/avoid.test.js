// Avoid list: negative calls recorded with a portfolio, scored as an equal-weight basket vs the benchmark.
// A call is a hit when the stock lagged the benchmark over the same window.
const fs = require('fs'); const path = require('path');
module.exports = ({ test, assert, loadApp, ROOT }) => {
  const lib = require(path.join(ROOT, 'tools/research-lib.js'));
  const fixture = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/portfolio-fixture.json'), 'utf8'));
  const days = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'];
  const flat = (v) => days.map(d => ({ date: d, adj: v }));
  const path_ = (vals) => days.map((d, i) => ({ date: d, adj: vals[i] }));
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
  const withAvoid = () => {
    const p = fixture();
    p.avoid = [
      { ticker: 'XXA', type: 'stock', reason: 'priced for growth it will not get', entryPrice: 10 },
      { ticker: 'XXB', type: 'stock', reason: 'pills replace injectables', entryPrice: 20 },
    ];
    return p;
  };
  const series = (p) => Object.fromEntries([...p.positions.map(x => [x.ticker, flat(1)]), [p.benchmark, path_([100, 102, 105, 110])],
    ['XXA', path_([10, 9, 8.5, 8])], ['XXB', path_([20, 20, 21, 20])]]);

  test('no avoid list → avoid is null', () => {
    const p = fixture(); const s = loadApp().scorePortfolio(p, series(p), '2026-01-07');
    assert.equal(s.avoid, null);
  });

  test('basket return, per-name vs benchmark, and hit count', () => {
    const p = withAvoid(); const s = loadApp().scorePortfolio(p, series(p), '2026-01-07');
    const a = s.avoid; assert.equal(a.why, null);
    const A = a.rows.find(r => r.ticker === 'XXA'), B = a.rows.find(r => r.ticker === 'XXB');
    close(A.ret, -0.2, 'XXA'); close(A.vsBench, -0.3, 'XXA vs bench'); assert.equal(A.hit, true);
    close(B.ret, 0, 'XXB'); close(B.vsBench, -0.1, 'XXB vs bench'); assert.equal(B.hit, true);
    close(a.basketRet, -0.1, 'basket'); close(a.benchRet, 0.1, 'bench'); assert.equal(a.hits, 2); assert.equal(a.scored, 2);
  });

  test('a name that beat the benchmark is a miss', () => {
    const p = withAvoid(); const ser = series(p); ser.XXB = path_([20, 22, 25, 30]);
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    assert.equal(s.avoid.rows.find(r => r.ticker === 'XXB').hit, false); assert.equal(s.avoid.hits, 1);
  });

  test('missing avoid series → row unavailable, basket null with reason, others still scored', () => {
    const p = withAvoid(); const ser = series(p); delete ser.XXB;
    const a = loadApp().scorePortfolio(p, ser, '2026-01-07').avoid;
    assert.equal(a.basketRet, null); assert.match(a.why, /XXB/);
    close(a.rows.find(r => r.ticker === 'XXA').ret, -0.2, 'XXA still scored');
    assert.match(a.rows.find(r => r.ticker === 'XXB').why, /unavailable/);
  });

  test('avoid list is scored even when a holding is missing', () => {
    const p = withAvoid(); const ser = series(p); delete ser.AAA;
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    assert.equal(s.total, null); assert.equal(s.avoid.hits, 2);
  });

  test('avoid scoring freezes at horizon end', () => {
    const p = withAvoid(); p.horizonYears = 1;
    const d = ['2026-01-02', '2026-12-31', '2027-03-01'];
    const ser = Object.fromEntries([...p.positions.map(x => [x.ticker, d.map(date => ({ date, adj: 1 }))]), [p.benchmark, d.map(date => ({ date, adj: 100 }))],
      ['XXA', d.map((date, i) => ({ date, adj: [10, 5, 50][i] }))], ['XXB', d.map(date => ({ date, adj: 20 }))]]);
    close(loadApp().scorePortfolio(p, ser, '2027-06-01').avoid.rows.find(r => r.ticker === 'XXA').ret, -0.5, 'frozen at 2026-12-31');
  });

  const fp = (p) => { p.fingerprint = lib.fingerprint(p); return p; };
  test('valid avoid list passes validation', () => assert.deepEqual(lib.validatePortfolio(fp(withAvoid())), []));
  test('avoid entry needs a reason', () => {
    const p = withAvoid(); p.avoid[0].reason = ''; assert.ok(lib.validatePortfolio(fp(p)).some(e => /avoid XXA: reason/.test(e)));
  });
  test('avoid entry needs a positive entry price', () => {
    const p = withAvoid(); delete p.avoid[1].entryPrice; assert.ok(lib.validatePortfolio(fp(p)).some(e => /avoid XXB: entryPrice/.test(e)));
  });
  test('a ticker cannot be both held and avoided', () => {
    const p = withAvoid(); p.avoid[0].ticker = 'AAA'; assert.ok(lib.validatePortfolio(fp(p)).some(e => /AAA.*both/.test(e)));
  });
  test('duplicate avoid ticker rejected', () => {
    const p = withAvoid(); p.avoid[1].ticker = 'XXA'; assert.ok(lib.validatePortfolio(fp(p)).some(e => /avoid XXA: duplicate/.test(e)));
  });
  test('avoid must be an array when present', () => {
    const p = fixture(); p.avoid = 'WST'; assert.ok(lib.validatePortfolio(fp(p)).some(e => /avoid must be an array/.test(e)));
  });
  test('fingerprint covers the avoid list (adding, editing reason or price breaks it)', () => {
    const a = fp(withAvoid());
    const b = withAvoid(); b.avoid[0].reason = 'changed'; b.fingerprint = a.fingerprint;
    assert.ok(lib.validatePortfolio(b).some(e => /fingerprint/.test(e)));
    const c = withAvoid(); c.avoid[1].entryPrice = 21; c.fingerprint = a.fingerprint;
    assert.ok(lib.validatePortfolio(c).some(e => /fingerprint/.test(e)));
    const d = fixture(); d.fingerprint = lib.fingerprint(d); d.avoid = [{ ticker: 'XXA', type: 'stock', reason: 'r', entryPrice: 1 }];
    assert.ok(lib.validatePortfolio(d).some(e => /fingerprint/.test(e)));
  });
};
