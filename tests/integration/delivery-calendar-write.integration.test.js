const { DataSource } = require('typeorm');
const { CreateAdminAuditEvents1700000000016 } = require('../../src/infrastructure/migrations/1700000000016-create-admin-audit-events');
const { CreateDeliveryClosedDays1700000000021 } = require('../../src/infrastructure/migrations/1700000000021-create-delivery-closed-days');
const { AddDeliveryClosedDayType1700000000027 } = require('../../src/infrastructure/migrations/1700000000027-add-delivery-closed-day-type');
const { CreateDeliveryCalendarStripeSyncs1700000000028 } = require('../../src/infrastructure/migrations/1700000000028-create-delivery-calendar-stripe-syncs');
const { DeliveryClosedDaysRepository } = require('../../src/infrastructure/repositories/delivery-closed-days.repository');
const { DeliveryCalendarStripeSyncsRepository } = require('../../src/infrastructure/repositories/delivery-calendar-stripe-syncs.repository');
const { AdminAuditRepository } = require('../../src/infrastructure/repositories/admin-audit.repository');
const { AdminDeliveryCalendarService } = require('../../src/services/admin-delivery-calendar.service');
const { DeliveryCalendarImpactService, prepMidnight } = require('../../src/services/delivery-calendar-impact.service');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

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

const NOW = new Date('2027-12-10T15:00:00Z');
const TZ = 'America/New_York';

function trialing(id) {
  return {
    stripeSubscriptionId: id, ledgerId: 1, userId: 70, market: 'US', status: 'trialing',
    chargeAt: prepMidnight('2027-12-21', TZ), termMonths: 1, chargedCount: null, transitDays: 1,
    productionStatus: 'to_prepare', pendingDeliveryChanges: null, paidCycle: null
  };
}

// A closure that moves three trialing subscriptions, where the second sync row cannot be written.
describeIntegration('a calendar closure is all or nothing (MySQL)', () => {
  const database = `it_${Date.now()}_calwrite`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let syncs;
  let service;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateAdminAuditEvents1700000000016().up(runner);
    await new CreateDeliveryClosedDays1700000000021().up(runner);
    await new AddDeliveryClosedDayType1700000000027().up(runner);
    await new CreateDeliveryCalendarStripeSyncs1700000000028().up(runner);
    await runner.release();

    syncs = new DeliveryCalendarStripeSyncsRepository(dataSource);
    service = new AdminDeliveryCalendarService({
      calendarRepository: new DeliveryClosedDaysRepository(dataSource),
      impactService: new DeliveryCalendarImpactService({
        subscriptions: { listForMarket: async () => [trialing('sub_a'), trialing('sub_b'), trialing('sub_c')] },
        now: () => NOW
      }),
      syncsRepository: syncs,
      auditRepository: new AdminAuditRepository(dataSource),
      dataSource,
      now: () => NOW
    });
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  async function counts() {
    const [days] = await dataSource.query("SELECT COUNT(*) AS n FROM delivery_closed_days WHERE market = 'US' AND type = 'adhoc'");
    const [queued] = await dataSource.query('SELECT COUNT(*) AS n FROM delivery_calendar_stripe_syncs');
    const [events] = await dataSource.query("SELECT COUNT(*) AS n FROM admin_audit_events WHERE action LIKE 'delivery\\_calendar.%'");
    return { days: Number(days.n), syncs: Number(queued.n), events: Number(events.n) };
  }

  const body = {
    type: 'adhoc', label: 'Manutenção', closedOn: '2027-12-21',
    closesPreparation: true, closesPickup: true, closesDelivery: true
  };

  test('a failure on the second sync leaves no row, no sync, and no audit event', async () => {
    const insertPending = syncs.insertPending.bind(syncs);
    let calls = 0;
    syncs.insertPending = async (executor, input) => {
      calls += 1;
      if (calls === 2) throw new Error('sync insert failed');
      return insertPending(executor, input);
    };
    await expect(service.write({ marketQuery: { market: 'US' }, body, identity: { userId: '7', email: 'op@edenbowls.com' } }))
      .rejects.toThrow('sync insert failed');
    expect(await counts()).toEqual({ days: 0, syncs: 0, events: 0 });
    syncs.insertPending = insertPending;
  });

  test('the same closure without the failure stores all of it, linked to one event', async () => {
    const result = await service.write({ marketQuery: { market: 'US' }, body, identity: { userId: '7', email: 'op@edenbowls.com' } });
    expect(await counts()).toEqual({ days: 1, syncs: 3, events: 1 });
    const linked = await dataSource.query('SELECT DISTINCT audit_event_id FROM delivery_calendar_stripe_syncs');
    expect(linked.map((row) => Number(row.audit_event_id))).toEqual([result.auditEventId]);
    const history = await new AdminAuditRepository(dataSource).listDeliveryCalendar({ market: 'US', year: 2027 });
    expect(history).toEqual([expect.objectContaining({ action: 'delivery_calendar.create', actorEmail: 'op@edenbowls.com' })]);
    expect(history[0].metadata.moved).toHaveLength(3);
  });
});
