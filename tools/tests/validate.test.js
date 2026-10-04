const fs = require('fs'); const path = require('path');
module.exports = ({ test, assert, ROOT }) => {
  const lib = require(path.join(ROOT, 'tools/research-lib.js'));
  const fixture = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/portfolio-fixture.json'), 'utf8'));
  const valid = () => { const p = fixture(); p.fingerprint = lib.fingerprint(p); return p; };

  test('fixture is valid once fingerprinted', () => assert.deepEqual(lib.validatePortfolio(valid()), []));
  test('committed fixture fingerprint is current', () => assert.equal(fixture().fingerprint, lib.fingerprint(fixture())));

  test('fingerprint ignores check-ins and research log, covers weights and prices', () => {
    const a = valid(), b = valid();
    b.checkIns.push({ date: '2026-02-01', positions: [], summary: 'x' }); b.researchLog.themes = [];
    assert.equal(lib.fingerprint(a), lib.fingerprint(b));
    b.positions[0].entryPrice = 11; assert.notEqual(lib.fingerprint(a), lib.fingerprint(b));
  });

  test('edited entry price fails validation', () => {
    const p = valid(); p.positions[0].entryPrice = 11;
    assert.ok(lib.validatePortfolio(p).some(e => /fingerprint/.test(e)));
  });

  const broken = (mutate, re) => () => { const p = fixture(); mutate(p); p.fingerprint = lib.fingerprint(p); assert.ok(lib.validatePortfolio(p).some(e => re.test(e)), `expected ${re}`); };
  test('too few positions', broken(p => { p.positions = p.positions.slice(0, 9); p.cashWeight = 1 - p.positions.reduce((s, x) => s + x.weight, 0); }, /10–20 positions/));
  test('weight over 15%', broken(p => { p.positions[0].weight = 0.2; p.cashWeight = 0.05; }, /15%/));
  test('weights not summing to 1', broken(p => { p.cashWeight = 0.2; }, /sum/));
  test('theme over 35%', broken(p => { p.positions[2].theme = 't1'; p.positions[3].theme = 't1'; }, /theme t1/));
  test('missing thesis field', broken(p => { p.positions[0].thesis.variant = ''; }, /variant/));
  test('bad type', broken(p => { p.positions[0].type = 'option'; }, /type/));
  test('duplicate ticker', broken(p => { p.positions[1].ticker = 'AAA'; }, /duplicate/));
  test('horizon out of range', broken(p => { p.horizonYears = 6; }, /horizonYears/));
  test('bad check-in status', broken(p => { p.checkIns = [{ date: '2026-02-01', positions: [{ ticker: 'AAA', status: 'meh', note: '' }], summary: '' }]; }, /status/));
  test('check-in for unknown ticker', broken(p => { p.checkIns = [{ date: '2026-02-01', positions: [{ ticker: 'NOPE', status: 'intact', note: '' }], summary: '' }]; }, /NOPE/));
  test('check-in before entry', broken(p => { p.checkIns = [{ date: '2025-12-01', positions: [], summary: '' }]; }, /before entry/));

  test('validateAll catches duplicate ids and dangling derivedFrom', () => {
    const a = valid(), b = valid(); const c = valid(); c.id = 'X'; c.derivedFrom = 'MISSING'; c.fingerprint = lib.fingerprint(c);
    const errs = lib.validateAll([a, b, c]);
    assert.ok(errs.some(e => /duplicate id/.test(e))); assert.ok(errs.some(e => /derivedFrom/.test(e)));
  });
};
