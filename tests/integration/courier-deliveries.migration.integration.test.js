const { DataSource } = require('typeorm');
const { CreateCourierDeliveries1700000000063 } = require('../../src/infrastructure/migrations/1700000000063-create-courier-deliveries');
const { AddCourierFailureKind1700000000064 } = require('../../src/infrastructure/migrations/1700000000064-add-courier-failure-kind');
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
    await new AddCourierFailureKind1700000000064().up(runner);
    await new AddCourierFailureKind1700000000064().up(runner);
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

  test('migration 064 stores the failure kind and goes down and up again', async () => {
    const row = (await dispatch('in_kind')).row;
    await repository.transition(row.id, 'failed', { reason: 'Portaria', kind: 'address_unusable' });
    expect((await repository.findById(row.id)).failure_kind).toBe('address_unusable');

    await new AddCourierFailureKind1700000000064().down(runner);
    const [column] = await dataSource.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courier_deliveries' AND COLUMN_NAME = 'failure_kind'");
    expect(Number(column.n)).toBe(0);
    await new AddCourierFailureKind1700000000064().up(runner);
  });

  test('counts for Today: a failure sent again is not open, and only long trips count', async () => {
    const failedOnce = (await dispatch('in_cnt_a')).row;
    await repository.transition(failedOnce.id, 'failed', { reason: 'Ninguém em casa' });
    await dispatch('in_cnt_a');
    const stillFailed = (await dispatch('in_cnt_b')).row;
    await repository.transition(stillFailed.id, 'failed', { reason: 'Portaria' });
    const twice = (await dispatch('in_cnt_c')).row;
    await repository.transition(twice.id, 'failed', { reason: 'x' });
    const again = (await dispatch('in_cnt_c')).row;
    await repository.transition(again.id, 'failed', { reason: 'y' });

    const before = await repository.countOpenFailures(['br']);
    expect(await repository.countOpenFailures([])).toBe(0);
    const failedInvoices = (await dataSource.query(
      "SELECT DISTINCT f.stripe_invoice_id AS id FROM courier_deliveries f WHERE f.status = 'failed' AND NOT EXISTS (SELECT 1 FROM courier_deliveries a WHERE a.stripe_invoice_id = f.stripe_invoice_id AND a.status IN ('out_for_delivery', 'delivered'))"
    )).map((row) => row.id);
    expect(failedInvoices).toEqual(expect.arrayContaining(['in_cnt_b', 'in_cnt_c']));
    expect(failedInvoices).not.toContain('in_cnt_a');
    expect(await repository.countOpenFailures(null)).toBe(failedInvoices.length);
    expect(before).toBe(0);

    await dataSource.query("UPDATE courier_deliveries SET out_for_delivery_at = ? WHERE stripe_invoice_id = 'in_cnt_a' AND status = 'out_for_delivery'", [new Date(Date.now() - 30 * 3600 * 1000)]);
    const onTheRoadLong = await repository.countOnTheRoadSince(new Date(Date.now() - 24 * 3600 * 1000));
    const [{ n }] = await dataSource.query("SELECT COUNT(*) AS n FROM courier_deliveries WHERE status = 'out_for_delivery' AND out_for_delivery_at < ?", [new Date(Date.now() - 24 * 3600 * 1000)]);
    expect(onTheRoadLong).toBe(Number(n));
    expect(onTheRoadLong).toBeGreaterThanOrEqual(1);
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
