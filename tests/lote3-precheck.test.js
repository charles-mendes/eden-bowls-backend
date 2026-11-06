const { precheckQueries } = require('../src/scripts/lote3-precheck');

describe('lote 3 precheck', () => {
  test('every query is a read-only count over the open paid cycles', () => {
    const queries = precheckQueries({ queueSourceSql: '(SELECT 1) q' });
    expect(Object.keys(queries)).toEqual([
      'openPaidCycles', 'incompleteAddress', 'brazilNfeNotAuthorized', 'brazilWithoutNfe',
      'brazilWithoutFiscalName', 'addressCountryOtherThanAccount', 'profileMarketOtherThanAccount'
    ]);
    for (const sql of Object.values(queries)) {
      expect(sql).toMatch(/^SELECT COUNT\(\*\) AS total FROM /);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
      expect(sql).toContain("q.payment_state = 'paid'");
    }
  });
});
