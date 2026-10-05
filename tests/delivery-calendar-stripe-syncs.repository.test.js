const { DataSource } = require('typeorm');
const {
  DeliveryCalendarStripeSyncsRepository,
  backoffMs
} = require('../src/infrastructure/repositories/delivery-calendar-stripe-syncs.repository');
const { CreateDeliveryCalendarStripeSyncs1700000000028 } = require('../src/infrastructure/migrations/1700000000028-create-delivery-calendar-stripe-syncs');

function fakeDb(pending = []) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('FOR UPDATE')) return pending;
      if (sql.trim().startsWith('INSERT')) return { insertId: 41 };
      return [];
    })
  };
}

describe('DeliveryCalendarStripeSyncsRepository', () => {
  test('insertPending writes a pending row with the expected and target values in UTC', async () => {
    const tx = fakeDb();
    const id = await new DeliveryCalendarStripeSyncsRepository(null).insertPending(tx, {
      stripeSubscriptionId: 'sub_1',
      market: 'US',
      expectedTrialEnd: '2027-12-23T05:00:00.000Z',
      targetTrialEnd: '2027-12-27T05:00:00.000Z'
    });
    expect(id).toBe(41);
    const insert = tx.calls.find((call) => call.sql.startsWith('INSERT'));
    expect(insert.params).toEqual(['sub_1', 'US', null, '2027-12-23 05:00:00', '2027-12-27 05:00:00']);
    expect(tx.calls.some((call) => call.sql.includes("status = 'superseded'"))).toBe(false);
  });

  test('a pending row of the same subscription is superseded and its expected value carried over', async () => {
    const tx = fakeDb([{ id: 7, expected_trial_end: new Date('2027-12-20T05:00:00Z') }]);
    await new DeliveryCalendarStripeSyncsRepository(null).insertPending(tx, {
      stripeSubscriptionId: 'sub_1',
      market: 'US',
      expectedTrialEnd: '2027-12-23T05:00:00.000Z',
      targetTrialEnd: '2027-12-27T05:00:00.000Z'
    });
    const supersede = tx.calls.find((call) => call.sql.includes("status = 'superseded'"));
    expect(supersede.params).toEqual(['sub_1']);
    const insert = tx.calls.find((call) => call.sql.startsWith('INSERT'));
    expect(insert.params[3]).toBe('2027-12-20 05:00:00');
  });

  test('backoff doubles from one minute and stops at an hour', () => {
    expect(backoffMs(1)).toBe(60 * 1000);
    expect(backoffMs(2)).toBe(2 * 60 * 1000);
    expect(backoffMs(4)).toBe(8 * 60 * 1000);
    expect(backoffMs(20)).toBe(60 * 60 * 1000);
  });

  test('recordAttempt keeps the row pending until the attempt limit, then marks it failed', async () => {
    const db = fakeDb();
    const repository = new DeliveryCalendarStripeSyncsRepository(db);
    const now = new Date('2027-12-22T12:00:00Z');
    const retry = await repository.recordAttempt(3, { error: new Error('timeout'), now, attempts: 0, maxAttempts: 8 });
    expect(retry).toEqual({ status: 'pending', attempts: 1, nextAttemptAt: '2027-12-22T12:01:00.000Z' });
    const failed = await repository.recordAttempt(3, { error: new Error('timeout'), now, attempts: 7, maxAttempts: 8 });
    expect(failed).toEqual({ status: 'failed', attempts: 8 });
    expect(db.calls[1].sql).toContain("status = 'failed'");
  });

  test('every status change only touches a pending row', async () => {
    const db = fakeDb();
    const repository = new DeliveryCalendarStripeSyncsRepository(db);
    await repository.markSynced(3, new Date('2027-12-22T12:00:00Z'));
    await repository.markConflict(3, '2027-12-29T05:00:00.000Z');
    expect(db.calls[0].sql).toContain("status = 'synced'");
    expect(db.calls[1].sql).toContain("status = 'conflict'");
    expect(db.calls[1].params).toEqual(['2027-12-29 05:00:00', 3]);
    for (const call of db.calls) expect(call.sql).toContain("AND status = 'pending'");
  });
});

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('DeliveryCalendarStripeSyncsRepository on MySQL', () => {
  const connection = {
    type: 'mysql',
    host: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
    port: Number(process.env.INTEGRATION_DB_PORT || 3310),
    username: process.env.INTEGRATION_DB_USER || 'root',
    password: process.env.INTEGRATION_DB_PASSWORD || 'root',
    charset: 'utf8mb4',
    timezone: 'Z',
    entities: [],
    migrations: [],
    synchronize: false,
    logging: false
  };
  const database = `it_${Date.now()}_syncrepo`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let repository;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateDeliveryCalendarStripeSyncs1700000000028().up(runner);
    await runner.release();
    repository = new DeliveryCalendarStripeSyncsRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('the panel lists pending rows older than the delay and every failed or conflict row', async () => {
    const now = new Date('2027-12-10T15:00:00Z');
    const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await dataSource.query(
      `INSERT INTO delivery_calendar_stripe_syncs (stripe_subscription_id, market, target_trial_end, status, created_at) VALUES
        ('sub_p20', 'BR', '2027-12-27 03:00:00', 'pending', ?),
        ('sub_p10', 'BR', '2027-12-27 03:00:00', 'pending', ?),
        ('sub_f', 'BR', '2027-12-27 03:00:00', 'failed', ?),
        ('sub_c', 'BR', '2027-12-27 03:00:00', 'conflict', ?),
        ('sub_s', 'BR', '2027-12-27 03:00:00', 'synced', ?),
        ('sub_x', 'BR', '2027-12-27 03:00:00', 'superseded', ?),
        ('sub_us', 'US', '2027-12-27 05:00:00', 'failed', ?)`,
      [at(20), at(10), at(1), at(1), at(60), at(60), at(1)]
    );
    const rows = await repository.listForPanel('BR', { now, delayMinutes: 15 });
    expect(rows.map((row) => row.stripeSubscriptionId)).toEqual(['sub_p20', 'sub_f', 'sub_c']);
    await dataSource.query('DELETE FROM delivery_calendar_stripe_syncs');
  });

  test('reopen puts a conflict back to pending with the found value as expected, once', async () => {
    await dataSource.query(
      `INSERT INTO delivery_calendar_stripe_syncs
        (stripe_subscription_id, market, expected_trial_end, target_trial_end, found_trial_end, status, attempts, last_error)
       VALUES ('sub_r', 'US', '2027-12-21 05:00:00', '2027-12-22 05:00:00', '2028-01-24 05:00:00', 'conflict', 3, 'x')`
    );
    const [{ id }] = await dataSource.query("SELECT id FROM delivery_calendar_stripe_syncs WHERE stripe_subscription_id = 'sub_r'");
    const now = new Date('2027-12-10T15:00:00Z');
    expect(await repository.reopen(null, id, { fromStatus: 'conflict', expectedTrialEnd: '2028-01-24T05:00:00.000Z', now })).toBe(true);
    expect(await repository.findById(id)).toMatchObject({
      status: 'pending', attempts: 0, lastError: null, expectedTrialEnd: '2028-01-24T05:00:00.000Z', nextAttemptAt: '2027-12-10T15:00:00.000Z'
    });
    expect(await repository.reopen(null, id, { fromStatus: 'conflict', expectedTrialEnd: null, now })).toBe(false);
    await dataSource.query('DELETE FROM delivery_calendar_stripe_syncs');
  });

  test('supersede, claim, retry, and the final states', async () => {
    const first = await dataSource.transaction((manager) => repository.insertPending(manager, {
      stripeSubscriptionId: 'sub_9',
      market: 'US',
      expectedTrialEnd: '2027-12-23T05:00:00.000Z',
      targetTrialEnd: '2027-12-27T05:00:00.000Z'
    }));
    const second = await dataSource.transaction((manager) => repository.insertPending(manager, {
      stripeSubscriptionId: 'sub_9',
      market: 'US',
      expectedTrialEnd: '2027-12-27T05:00:00.000Z',
      targetTrialEnd: '2027-12-28T05:00:00.000Z'
    }));
    expect((await repository.findById(first)).status).toBe('superseded');
    expect(await repository.findById(second)).toMatchObject({
      status: 'pending',
      expectedTrialEnd: '2027-12-23T05:00:00.000Z',
      targetTrialEnd: '2027-12-28T05:00:00.000Z'
    });

    const now = new Date();
    expect((await repository.claimDue(now)).map((row) => row.id)).toEqual([second]);
    await repository.recordAttempt(second, { error: 'timeout', now, attempts: 0, maxAttempts: 8 });
    expect(await repository.claimDue(now)).toEqual([]);
    expect((await repository.claimDue(new Date(now.getTime() + 2 * 60 * 1000))).map((row) => row.id)).toEqual([second]);

    await repository.markConflict(second, '2027-12-30T05:00:00.000Z');
    expect(await repository.findById(second)).toMatchObject({ status: 'conflict', foundTrialEnd: '2027-12-30T05:00:00.000Z' });
    await repository.markSynced(second, now);
    expect((await repository.findById(second)).status).toBe('conflict');
  });
});
