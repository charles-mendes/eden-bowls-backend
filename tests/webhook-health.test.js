const { buildWebhookHealth, webhookHealthWindows, webhookStatus } = require('../src/core/webhook-health');

const now = new Date('2026-10-08T12:00:00Z');
const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);

describe('webhook health', () => {
  test('is ok with a recent event and nothing failed or stuck', () => {
    expect(webhookStatus({ lastEventAt: hoursAgo(3) }, now)).toBe('ok');
  });

  test('needs attention after 72 hours of silence', () => {
    expect(webhookStatus({ lastEventAt: hoursAgo(72) }, now)).toBe('ok');
    expect(webhookStatus({ lastEventAt: hoursAgo(80) }, now)).toBe('attention');
  });

  test('needs attention with a failure in the last 24 hours', () => {
    expect(webhookStatus({ lastEventAt: hoursAgo(0.2), failedLast24h: 1 }, now)).toBe('attention');
  });

  test('needs attention with an event stuck for over an hour', () => {
    expect(webhookStatus({ lastEventAt: hoursAgo(2), pendingOverdue: 1 }, now)).toBe('attention');
  });

  test('reports no_events when nothing was received', () => {
    expect(webhookStatus({ lastEventAt: null }, now)).toBe('no_events');
  });

  test('builds one entry per account, filling missing ones', () => {
    const health = buildWebhookHealth([
      { account: 'us', lastEventAt: hoursAgo(2), lastEventType: 'invoice.paid', failedLast24h: 0, pendingOverdue: 0 }
    ], now);

    expect(health).toEqual({
      generatedAt: now.toISOString(),
      staleAfterHours: 72,
      accounts: [
        { account: 'br', status: 'no_events', lastEventAt: null, lastEventType: null, failedLast24h: 0, pendingOverdue: 0 },
        { account: 'us', status: 'ok', lastEventAt: hoursAgo(2).toISOString(), lastEventType: 'invoice.paid', failedLast24h: 0, pendingOverdue: 0 }
      ]
    });
  });

  test('derives the 24 hour and 1 hour windows from now', () => {
    expect(webhookHealthWindows(now)).toEqual({ failedSince: hoursAgo(24), overdueBefore: hoursAgo(1) });
  });
});
