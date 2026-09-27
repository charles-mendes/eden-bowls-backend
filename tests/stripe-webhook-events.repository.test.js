const { StripeWebhookEventsRepository } = require('../src/infrastructure/repositories/stripe-webhook-events.repository');

function createRepository(query) {
  return new StripeWebhookEventsRepository({ isInitialized: true, query });
}

describe('StripeWebhookEventsRepository', () => {
  test('inserts a pending event with processed_at null', async () => {
    const query = jest.fn().mockResolvedValue({});
    const repository = createRepository(query);

    await repository.insertIfNew({
      eventId: 'evt_1',
      stripeAccount: 'us',
      type: 'invoice.paid',
      payloadSummary: { type: 'invoice.paid' }
    });

    const sql = query.mock.calls[0][0];
    expect(sql).toContain('`processed_at`');
    expect(sql).toContain('NULL');
    expect(sql).not.toContain('`processed_at`, `payload_summary`) VALUES (?, ?, ?, CURRENT_TIMESTAMP');
  });

  test('maps an insert-only row as pending with the stored attempt count', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{
        eventId: 'evt_pending',
        stripeAccount: 'us',
        type: 'invoice.paid',
        processedAt: null,
        failedAt: null,
        attempts: 2,
        createdAt: '2026-01-01 00:00:00'
      }]);
    const repository = createRepository(query);

    const result = await repository.listEvents({ offset: 0, perPage: 20 });

    expect(result.items[0]).toMatchObject({
      eventId: 'evt_pending',
      state: 'pending',
      attempts: 2
    });
  });

  test('maps failed and processed rows from stored columns', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([
        { eventId: 'evt_failed', stripeAccount: 'us', type: 'invoice.paid', processedAt: null, failedAt: '2026-01-02', attempts: 8 },
        { eventId: 'evt_done', stripeAccount: 'br', type: 'invoice.paid', processedAt: '2026-01-02', failedAt: null, attempts: 1 }
      ]);
    const repository = createRepository(query);

    const result = await repository.listEvents({ offset: 0, perPage: 20 });

    expect(result.items.map((item) => item.state)).toEqual(['failed', 'processed']);
    expect(result.items.map((item) => item.attempts)).toEqual([8, 1]);
  });

  test('deletes only processed events older than the cutoff', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 3 });
    const repository = createRepository(query);
    const cutoff = new Date('2025-01-01T00:00:00Z');

    await expect(repository.deleteProcessedBefore(cutoff)).resolves.toBe(3);

    const sql = query.mock.calls[0][0];
    expect(sql).toContain('`processed_at` IS NOT NULL');
    expect(sql).toContain('`failed_at` IS NULL');
    expect(sql).toContain('`processed_at` < ?');
    expect(query.mock.calls[0][1]).toEqual([cutoff]);
  });
});
