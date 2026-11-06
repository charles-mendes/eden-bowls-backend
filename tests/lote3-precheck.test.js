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

  test('the incomplete count includes a missing recipient, with the aliases the locks read', () => {
    const { incompleteAddress } = precheckQueries({ queueSourceSql: '(SELECT 1) q' });
    for (const key of ['recipient_name', 'full_name', 'line1', 'address_line1', 'postal_code', 'zipcode', 'region']) {
      expect(incompleteAddress).toContain(`'$.${key}'`);
    }
  });

  test('the country count uses the market exception rule, so an empty country counts', () => {
    const { addressCountryOtherThanAccount } = precheckQueries({ queueSourceSql: '(SELECT 1) q' });
    expect(addressCountryOtherThanAccount).toContain("NOT (");
    expect(addressCountryOtherThanAccount).toContain("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(q.address, '$.country')), '')");
  });
});
