// Reverse DCF: the growth rate today's price implies under Ledger's own owner-earnings DCF.
module.exports = ({ test, assert, loadApp }) => {
  const base = { price: null, netIncome: 1000, da: 200, capex: 300, expectedGrowth: 0.08, discountRate: 0.10, terminalGrowth: 0.025,
    cash: 500, totalDebt: 200, dilutedShares: 100 };

  test('round-trips: price set to DCF value at g recovers g', () => {
    const ctx = loadApp();
    for (const g of [-0.05, 0, 0.07, 0.25]) {
      const v = ctx.computeValuation({ ...base, expectedGrowth: g }).dcf.valuePerShare;
      const r = ctx.impliedGrowth({ ...base, price: v });
      assert.equal(r.why, null);
      assert.ok(Math.abs(r.g - g) < 1e-6, `expected ${g}, got ${r.g}`);
    }
  });

  test('no price → reason', () => {
    const r = loadApp().impliedGrowth({ ...base, price: null });
    assert.equal(r.g, null); assert.match(r.why, /price/);
  });

  test('owner earnings ≤ 0 → reason, not a number', () => {
    const r = loadApp().impliedGrowth({ ...base, price: 50, netIncome: -500 });
    assert.equal(r.g, null); assert.match(r.why, /owner earnings/);
  });

  test('price above the value at the top of the range → reason', () => {
    const r = loadApp().impliedGrowth({ ...base, price: 1e9 });
    assert.equal(r.g, null); assert.match(r.why, /exceeds/);
  });

  test('price below the value at the bottom of the range → reason', () => {
    const r = loadApp().impliedGrowth({ ...base, price: 0.0001, cash: 1e6 });
    assert.equal(r.g, null); assert.match(r.why, /below/);
  });

  test('discount rate ≤ terminal growth → reason', () => {
    const r = loadApp().impliedGrowth({ ...base, price: 50, discountRate: 0.02 });
    assert.equal(r.g, null); assert.match(r.why, /discount rate/);
  });

  test('share count 0 → reason, not a misleading growth rate', () => {
    const r = loadApp().impliedGrowth({ ...base, price: 50, dilutedShares: 0 });
    assert.equal(r.g, null); assert.match(r.why, /share count/);
  });
};
