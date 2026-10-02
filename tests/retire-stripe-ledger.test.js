const { validateOptions, retireStripeLedger } = require('../src/scripts/retire-stripe-ledger');

function queryMock(responses) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    const next = responses.shift();
    return next === undefined ? [] : next;
  });
  return { query, calls };
}

describe('retireStripeLedger', () => {
  test('rejects an unset runtime', () => {
    expect(validateOptions({
      runtime: '',
      confirm: true,
      createdBefore: '2026-10-02T00:00:00.000Z'
    })).toMatch(/qa or local/);
  });

  test('rejects a second run when the cursor is already set', async () => {
    const dataSource = queryMock([[{ cursor: '2026-10-01T00:00:00.000Z' }]]);

    await expect(retireStripeLedger({
      dataSource,
      runtime: 'qa',
      confirm: true,
      createdBefore: '2026-10-02T00:00:00.000Z'
    })).rejects.toThrow(/already ran/);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  test('deletes rows before the cutoff and records the cursor', async () => {
    const dataSource = queryMock([
      [],
      [{ id: 1, stripe_subscription_id: 'sub_old' }],
      [],
      [],
      [],
      []
    ]);

    await expect(retireStripeLedger({
      dataSource,
      runtime: 'local',
      confirm: true,
      createdBefore: '2026-10-02T00:00:00.000Z'
    })).resolves.toEqual({
      deletedSubscriptions: 1,
      cutoff: '2026-10-02T00:00:00.000Z'
    });

    const sql = dataSource.calls.map((call) => call.sql).join('\n');
    expect(sql).toContain('DELETE FROM `subscription_mail_claims`');
    expect(sql).toContain('DELETE FROM `ups_shipments`');
    expect(sql).toContain('DELETE FROM `stripe_subscriptions`');
    expect(dataSource.calls.some((call) => (
      Array.isArray(call.params)
      && call.params.includes('_hsr_stripe_customer_id')
      && call.params.includes('_hsr_stripe_customer_id_br')
      && call.params.includes('_hsr_stripe_customer_id_us')
    ))).toBe(true);
    expect(dataSource.calls.at(-1).params).toEqual([
      'stripe_ledger_retire',
      '2026-10-02T00:00:00.000Z'
    ]);
  });
});
