const fs = require('fs'); const path = require('path');
module.exports = ({ test, assert, ROOT }) => {
  const { assemble } = require(path.join(ROOT, 'tools/build.js'));
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/portfolio-fixture.json'), 'utf8'));

  test('public build ships an empty research array', () => {
    const html = assemble({ research: null });
    assert.ok(html.includes('/*RESEARCH_DATA*/[]/*END_RESEARCH_DATA*/'));
    assert.ok(!html.includes('TEST-FIXTURE'));
  });
  test('private build inlines the portfolios', () => {
    const html = assemble({ research: [fixture] });
    assert.ok(html.includes('"TEST-FIXTURE-1y"'));
    assert.ok(!html.includes('/*RESEARCH_DATA*/[]/*END_RESEARCH_DATA*/'));
  });
  test('private build escapes </script> inside research text', () => {
    const p = JSON.parse(JSON.stringify(fixture)); p.researchLog.themes[0].summary = '</script><b>x';
    const html = assemble({ research: [p] });
    assert.equal((html.match(/<\/script>/g) || []).length, 1);
  });
  test('committed ledger.html contains no research data', () => {
    const html = fs.readFileSync(path.join(ROOT, 'ledger.html'), 'utf8');
    assert.ok(html.includes('/*RESEARCH_DATA*/[]/*END_RESEARCH_DATA*/'));
  });
};
