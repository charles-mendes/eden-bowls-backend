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
    expect(query.mock.calls[0][1]).toEqual([20]);
  });

  test('does not track delivered or voided rows and keeps the previous payload on failure', async () => {
    const track = jest.fn()
      .mockResolvedValueOnce({ status: 'in_transit' })
      .mockRejectedValueOnce(new Error('ups down'));
    const updateTracking = jest.fn().mockResolvedValue({});
    const result = await runUpsTracking({
      upsClient: { timeoutMs: 5000, track },
      upsShipmentRepository: {
        listOpenForTracking: async () => [
          { id: 1, tracking_number: '1ZOK', status: 'created' },
          { id: 2, tracking_number: '1ZFAIL', status: 'created' },
          { id: 3, tracking_number: '1ZDEL', status: 'delivered' },
          { id: 4, tracking_number: '1ZVOID', status: 'voided' }
        ],
        updateTracking
      }
    });

    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledWith('1ZOK', { timeoutMs: 5000 });
    expect(updateTracking).toHaveBeenCalledTimes(1);
    expect(updateTracking).toHaveBeenCalledWith(1, '1ZOK', { status: 'in_transit' });
    expect(result.failed).toBe(1);
    expect(JOB_INTERVALS.ups_tracking).toBe(30 * 60 * 1000);
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
        client.tokenCache = { accessToken: 'token', expiresAt: Date.now() + 120000 };
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
