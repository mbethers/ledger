// Buybacks and share issuance are read from SEC filings so the screen can show shareholder yield
// (dividends + net buybacks, as a share of market cap).
module.exports = ({ test, assert, loadApp }) => {
  const pt = (val, start, end, form = '10-K', filed = '2026-02-15') => ({ val, start, end, form, filed, fy: +end.slice(0, 4), fp: 'FY' });
  const facts = (extra) => ({ facts: { 'us-gaap': {
    Revenues: { units: { USD: [pt(1000, '2025-01-01', '2025-12-31')] } },
    NetIncomeLoss: { units: { USD: [pt(100, '2025-01-01', '2025-12-31')] } },
    ...extra,
  } } });

  test('buybacks, issuance and net buybacks from annual cash-flow tags', () => {
    const v = loadApp().buildFundamentals(facts({
      PaymentsForRepurchaseOfCommonStock: { units: { USD: [pt(80, '2025-01-01', '2025-12-31')] } },
      ProceedsFromIssuanceOfCommonStock: { units: { USD: [pt(15, '2025-01-01', '2025-12-31')] } },
    }), '2026-03-01').values;
    assert.equal(v.buybacks, 80); assert.equal(v.stockIssued, 15); assert.equal(v.netBuybacks, 65);
  });

  test('no repurchase or issuance tags → 0, not missing', () => {
    const v = loadApp().buildFundamentals(facts({}), '2026-03-01').values;
    assert.equal(v.buybacks, 0); assert.equal(v.stockIssued, 0); assert.equal(v.netBuybacks, 0);
  });

  test('net issuance (dilution) shows as negative net buybacks', () => {
    const v = loadApp().buildFundamentals(facts({
      ProceedsFromIssuanceOfCommonStock: { units: { USD: [pt(40, '2025-01-01', '2025-12-31')] } },
    }), '2026-03-01').values;
    assert.equal(v.netBuybacks, -40);
  });
};
