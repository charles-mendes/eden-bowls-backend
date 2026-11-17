const { DataSource } = require('typeorm');
const { CreateCustomerContacts1700000000065 } = require('../../src/infrastructure/migrations/1700000000065-create-customer-contacts');
const { CustomerContactsRepository } = require('../../src/infrastructure/repositories/customer-contacts.repository');

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

describeIntegration('customer contacts (MySQL, migration 065)', () => {
  const database = `it_${Date.now()}_mig065`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;
  let repository;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreateCustomerContacts1700000000065().up(runner);
    await new CreateCustomerContacts1700000000065().up(runner);
    repository = new CustomerContactsRepository(dataSource);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('stores, lists newest first, picks the latest per subscription and deletes by user', async () => {
    const first = await repository.insert({ subscriptionId: '42', userId: 9, stripeAccount: 'br', reason: 'payment_failed', outcome: 'no_answer', actorId: 1, actorEmail: 'ops@edenbowls.com', createdAt: new Date('2026-11-03T14:00:00Z') });
    await repository.insert({ subscriptionId: '42', userId: 9, stripeAccount: 'br', reason: 'payment_failed', outcome: 'customer_will_fix', note: 'Vai trocar o cartão', createdAt: new Date('2026-11-04T10:00:00Z') });
    await repository.insert({ subscriptionId: '43', userId: 10, reason: 'late', outcome: 'resolved', createdAt: new Date('2026-11-04T11:00:00Z') });

    expect(first).toMatchObject({ subscription_id: '42', user_id: 9, reason: 'payment_failed', outcome: 'no_answer', note: null });
    expect((await repository.listBySubscription('42')).map((row) => row.outcome)).toEqual(['customer_will_fix', 'no_answer']);
    const latest = await repository.latestBySubscriptions(['42', '43', '99']);
    expect(latest.get('42').note).toBe('Vai trocar o cartão');
    expect(latest.get('43').outcome).toBe('resolved');
    expect(latest.has('99')).toBe(false);

    await repository.deleteByUser(9);
    expect(await repository.listByUser(9)).toEqual([]);
    expect(await repository.listByUser(10)).toHaveLength(1);
  });

  test('goes down and up again', async () => {
    await new CreateCustomerContacts1700000000065().down(runner);
    const [table] = await dataSource.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_contacts'");
    expect(Number(table.n)).toBe(0);
    await new CreateCustomerContacts1700000000065().up(runner);
  });
});
