const { SubscriptionLedgerRepository } = require('../src/infrastructure/repositories/subscription-ledger.repository');

function executor(pending) {
  return {
    query: jest.fn(async (sql) => (sql.includes('FOR UPDATE') ? [{ pending: pending ? JSON.stringify(pending) : null }] : { affectedRows: 1 }))
  };
}

describe('SubscriptionLedgerRepository.rewritePendingChargeMove', () => {
  const pending = {
    after_charge_at: '2027-12-10T20:00:00.000Z',
    packs: { packs_per_month: 3 },
    charge_move: { kind: 'reschedule', trial_end: 1829710800 }
  };

  test('moves the charge and keeps after_charge_at and the packs', async () => {
    const db = executor(pending);
    const changes = await new SubscriptionLedgerRepository(null).rewritePendingChargeMove(db, 'sub_1', { previous: 1829710800, next: 1829797200 });
    expect(changes).toEqual({ ...pending, charge_move: { kind: 'reschedule', trial_end: 1829797200 } });
    const [, params] = db.query.mock.calls[1];
    expect(JSON.parse(params[0])).toEqual(changes);
    expect(params[1]).toBe('sub_1');
  });

  test('refuses when the pending move is no longer where the preview saw it', async () => {
    const moved = executor({ ...pending, charge_move: { kind: 'skip', trial_end: 1830000000 } });
    await expect(new SubscriptionLedgerRepository(null).rewritePendingChargeMove(moved, 'sub_1', { previous: 1829710800, next: 1829797200 }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'pending_change_moved' } });
    expect(moved.query).toHaveBeenCalledTimes(1);
    await expect(new SubscriptionLedgerRepository(null).rewritePendingChargeMove(executor(null), 'sub_1', { previous: 1, next: 2 }))
      .rejects.toMatchObject({ details: { code: 'pending_change_moved' } });
  });
});
