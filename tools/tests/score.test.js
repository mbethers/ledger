// scorePortfolio: buy-and-hold with drift, adjusted-close returns, 0% cash, freeze at horizon end,
// missing data → total unavailable, exits held as cash.
const fs = require('fs'); const path = require('path');
module.exports = ({ test, assert, loadApp, ROOT }) => {
  const fixture = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/portfolio-fixture.json'), 'utf8'));
  const days = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'];
  const flat = (v) => days.map(d => ({ date: d, adj: v }));
  const path_ = (vals) => days.map((d, i) => ({ date: d, adj: vals[i] }));
  const allFlat = (p) => Object.fromEntries([...p.positions.map(x => [x.ticker, flat(1)]), [p.benchmark, flat(100)]]);
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

  test('everything flat → 0 return, 0 drawdown, 0 vol', () => {
    const p = fixture(); const s = loadApp().scorePortfolio(p, allFlat(p), '2026-01-07');
    assert.equal(s.why, null); close(s.total.ret, 0, 'ret'); close(s.total.maxDrawdown, 0, 'dd'); close(s.total.vol, 0, 'vol');
    assert.equal(s.curve.length, 4); close(s.curve[0][1], 100000, 'start $');
  });

  test('one 15% position doubles, cash stays flat → +15%', () => {
    const p = fixture(); const ser = allFlat(p); ser.AAA = path_([1, 1.5, 2, 2]);
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    close(s.total.ret, 0.15, 'ret'); close(s.positions.find(x => x.ticker === 'AAA').ret, 1, 'AAA ret');
    close(s.positions.find(x => x.ticker === 'AAA').contribution, 0.15, 'AAA contribution');
  });

  test('drawdown measured from running peak', () => {
    const p = fixture(); const ser = allFlat(p); ser.AAA = path_([1, 2, 1, 1]); // +15% then back to 0
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    close(s.total.maxDrawdown, 0.15 / 1.15, 'dd');
  });

  test('benchmark return and excess', () => {
    const p = fixture(); const ser = allFlat(p); ser['^SP500TR'] = path_([100, 101, 105, 110]);
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    close(s.total.benchRet, 0.10, 'bench'); close(s.total.excess, -0.10, 'excess');
  });

  test('missing series → total null with reason naming the ticker', () => {
    const p = fixture(); const ser = allFlat(p); delete ser.CCC;
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    assert.equal(s.total, null); assert.match(s.why, /CCC/); assert.deepEqual(s.curve, []);
    assert.match(s.positions.find(x => x.ticker === 'CCC').why, /unavailable/);
  });

  test('series starting after entry date counts as missing', () => {
    const p = fixture(); const ser = allFlat(p); ser.BBB = ser.BBB.slice(2);
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    assert.equal(s.total, null); assert.match(s.why, /BBB/);
  });

  test('score freezes at horizon end', () => {
    const p = fixture(); p.horizonYears = 1;
    const d = ['2026-01-02', '2026-12-31', '2027-01-04', '2027-06-01'];
    const ser = Object.fromEntries([...p.positions.map(x => [x.ticker, d.map((date, i) => ({ date, adj: [1, 1, 2, 4][i] }))]), [p.benchmark, d.map(date => ({ date, adj: 100 }))]]);
    const s = loadApp().scorePortfolio(p, ser, '2027-06-01');
    assert.equal(s.matured, true); assert.equal(s.endDate, '2027-01-02');
    close(s.total.ret, 0, 'frozen at the 2026-12-31 value'); assert.equal(s.curve.at(-1)[0], '2026-12-31');
  });

  test('exit via check-in: value held as cash after exit date', () => {
    const p = fixture(); const ser = allFlat(p); ser.AAA = path_([1, 2, 4, 8]);
    p.checkIns = [{ date: '2026-01-05', positions: [{ ticker: 'AAA', status: 'broken', note: 'acquired', exitPrice: 20 }], summary: 'x' }];
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    close(s.total.ret, 0.15, 'held at 2x after exit'); assert.equal(s.positions.find(x => x.ticker === 'AAA').exited, true);
    assert.equal(s.positions.find(x => x.ticker === 'AAA').status, 'broken');
  });

  test('exit with no series at all uses exitPrice/entryPrice and is marked approx', () => {
    const p = fixture(); const ser = allFlat(p); delete ser.AAA;
    p.checkIns = [{ date: '2026-01-05', positions: [{ ticker: 'AAA', status: 'broken', note: 'delisted', exitPrice: 5 }], summary: 'x' }];
    const s = loadApp().scorePortfolio(p, ser, '2026-01-07');
    assert.notEqual(s.total, null); close(s.total.ret, -0.075, 'half of 15%');
    assert.equal(s.positions.find(x => x.ticker === 'AAA').approx, true);
  });

  test('horizonEnd adds whole years', () => {
    assert.equal(loadApp().horizonEnd('2026-10-05', 3), '2029-10-05');
  });
};
