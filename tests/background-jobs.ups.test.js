const { UpsShipmentRepository } = require('../src/infrastructure/repositories/ups-shipment.repository');
const { UpsClient } = require('../src/infrastructure/shipping/ups-client');
const {
  JOB_INTERVALS,
  runUpsTracking,
  upsTrackTimeoutMs
} = require('../src/services/background-jobs.service');

describe('UPS tracking job', () => {
  test('the open-shipment query skips delivered and voided rows', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new UpsShipmentRepository({ isInitialized: true, query });

    await repository.listOpenForTracking(20);

    const sql = query.mock.calls[0][0];
    expect(sql).toContain("NOT IN ('delivered', 'voided')");
    expect(sql).toContain('`tracking_number` IS NOT NULL');
    expect(sql).toContain('ORDER BY `tracking_checked_at` ASC, `id` ASC');
    expect(query.mock.calls[0][1]).toEqual([20]);
  });

  test('does not track delivered or voided rows and keeps the previous payload on failure', async () => {
    const track = jest.fn()
      .mockResolvedValueOnce({ status: 'in_transit' })
      .mockRejectedValueOnce(new Error('ups down'));
    const recordTracking = jest.fn().mockResolvedValue({});
    const markTrackingChecked = jest.fn().mockResolvedValue();
    const result = await runUpsTracking({
      upsClient: { timeoutMs: 5000, track },
      upsShipmentRepository: {
        listOpenForTracking: async () => [
          { id: 1, tracking_number: '1ZOK', status: 'created' },
          { id: 2, tracking_number: '1ZFAIL', status: 'created' },
          { id: 3, tracking_number: '1ZDEL', status: 'delivered' },
          { id: 4, tracking_number: '1ZVOID', status: 'voided' }
        ],
        recordTracking,
        markTrackingChecked
      }
    });

    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledWith('1ZOK', { timeoutMs: 5000 });
    expect(recordTracking).toHaveBeenCalledTimes(1);
    expect(recordTracking).toHaveBeenCalledWith(1, null, { status: 'in_transit' });
    expect(markTrackingChecked).toHaveBeenCalledTimes(1);
    expect(markTrackingChecked).toHaveBeenCalledWith(2);
    expect(result.failed).toBe(1);
    expect(JOB_INTERVALS.ups_tracking).toBe(30 * 60 * 1000);
  });

  test('logs a failed track call without the tracking payload', async () => {
    const warn = jest.fn();
    const failure = Object.assign(new Error('UPS request failed.'), { details: { code: 'ups_upstream_error', status: 503 } });
    await runUpsTracking({
      logger: { warn },
      upsClient: { timeoutMs: 5000, track: jest.fn().mockRejectedValue(failure) },
      upsShipmentRepository: {
        listOpenForTracking: async () => [{ id: 2, tracking_number: '1ZFAIL', status: 'created' }],
        recordTracking: jest.fn(),
        markTrackingChecked: jest.fn().mockResolvedValue()
      }
    });

    expect(warn).toHaveBeenCalledWith({ shipmentId: 2, code: 'ups_upstream_error', status: 503 }, 'UPS tracking refresh failed.');
  });

  test('caps the track call at 5s for the default client and at 10s when the client allows 20s', () => {
    expect(upsTrackTimeoutMs(5000)).toBe(5000);
    expect(upsTrackTimeoutMs(20000)).toBe(10000);
  });

  test('a 5s client stops at 5s and a 20s client still stops at 10s', async () => {
    jest.useFakeTimers();
    try {
      const hangingFetch = (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });

      async function expectAbort(clientTimeoutMs, abortAtMs) {
        const client = new UpsClient({
          clientId: 'id',
          clientSecret: 'secret',
          timeoutMs: clientTimeoutMs,
          fetchImpl: hangingFetch
        });
        client.tokenCache = { baseUrl: client.baseUrl, accessToken: 'token', expiresAt: Date.now() + 120000 };
        const pending = client.track('1Z999', { timeoutMs: upsTrackTimeoutMs(clientTimeoutMs) });
        const assertion = expect(pending).rejects.toMatchObject({
          upsTimeout: true,
          details: { code: 'ups_timeout' }
        });
        await jest.advanceTimersByTimeAsync(abortAtMs - 1);
        let settled = false;
        pending.then(() => { settled = true; }, () => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        await assertion;
      }

      await expectAbort(5000, 5000);
      await expectAbort(20000, 10000);
    } finally {
      jest.useRealTimers();
    }
  });
});
