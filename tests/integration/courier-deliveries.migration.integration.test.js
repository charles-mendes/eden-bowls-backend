const { DataSource } = require('typeorm');
const { CreateCourierDeliveries1700000000063 } = require('../../src/infrastructure/migrations/1700000000063-create-courier-deliveries');
const { CourierDeliveryRepository } = require('../../src/infrastructure/repositories/courier-delivery.repository');

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

describeIntegration('migration 1700000000063 keeps one active courier delivery per invoice (MySQL)', () => {
  const database = `it_${Date.now()}_mig063`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;
  let repository;
  const dispatch = (invoiceId) => repository.insert({ subscriptionId: 'sub_1', invoiceId, method: 'uber' });

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreateCourierDeliveries1700000000063().up(runner);
    await new CreateCourierDeliveries1700000000063().up(runner);
    repository = new CourierDeliveryRepository(dataSource);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('two active rows for one invoice fail, and a delivered row still holds it', async () => {
    const first = await dispatch('in_a');
    expect(first).toMatchObject({ inserted: true, row: { status: 'out_for_delivery' } });
    await expect(dispatch('in_a')).resolves.toEqual({ inserted: false, row: null });

    await expect(repository.transition(first.row.id, 'delivered', {})).resolves.toBe(1);
    await expect(dispatch('in_a')).resolves.toMatchObject({ inserted: false });
    await expect(repository.transition(first.row.id, 'failed', { reason: 'x' })).resolves.toBe(0);
  });

  test('failed plus active, and canceled plus active, succeed', async () => {
    const failed = await dispatch('in_b');
    await repository.transition(failed.row.id, 'failed', { reason: 'Ninguém em casa' });
    await expect(dispatch('in_b')).resolves.toMatchObject({ inserted: true });

    const canceled = await dispatch('in_c');
    await repository.transition(canceled.row.id, 'canceled', {});
    await expect(dispatch('in_c')).resolves.toMatchObject({ inserted: true });

    const rows = await repository.listByInvoiceIds(['in_b', 'in_c']);
    expect(rows.map((row) => row.status).sort()).toEqual(['canceled', 'failed', 'out_for_delivery', 'out_for_delivery']);
  });

  test('concurrent dispatches leave exactly one row', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => dispatch('in_race')));
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
  });

  test('editing a canceled row changes nothing', async () => {
    const row = (await dispatch('in_d')).row;
    await repository.transition(row.id, 'canceled', {});
    await expect(repository.updateDetails(row.id, { note: 'late' })).resolves.toBe(0);
  });
});
