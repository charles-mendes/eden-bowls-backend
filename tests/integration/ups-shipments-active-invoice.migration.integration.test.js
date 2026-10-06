const { DataSource } = require('typeorm');
const { ExtendUsShippingAndCreateUpsShipments1700000000013 } = require('../../src/infrastructure/migrations/1700000000013-extend-us-shipping-and-create-ups-shipments');
const { AddUpsShipmentsActiveInvoiceUnique1700000000030 } = require('../../src/infrastructure/migrations/1700000000030-add-ups-shipments-active-invoice-unique');
const { UpsShipmentRepository } = require('../../src/infrastructure/repositories/ups-shipment.repository');

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

describeIntegration('migration 1700000000030 keeps one active UPS shipment per invoice (MySQL)', () => {
  const database = `it_${Date.now()}_mig030`;
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
    await new ExtendUsShippingAndCreateUpsShipments1700000000013().up(runner);
    await dataSource.query("INSERT INTO ups_shipments (subscription_id, stripe_invoice_id, status) VALUES ('sub_1', 'in_old', 'voided'), ('sub_1', 'in_old', 'created')");
    await new AddUpsShipmentsActiveInvoiceUnique1700000000030().up(runner);
    repository = new UpsShipmentRepository(dataSource);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('a second active row for the invoice is refused and voided rows do not count', async () => {
    const first = await repository.insertPending({ subscriptionId: 'sub_2', invoiceId: 'in_new' });
    expect(first).toMatchObject({ status: 'pending', stripe_invoice_id: 'in_new' });
    await expect(repository.insertPending({ subscriptionId: 'sub_2', invoiceId: 'in_new' })).resolves.toBeNull();

    await repository.markUnknown(first.id);
    await expect(repository.insertPending({ subscriptionId: 'sub_2', invoiceId: 'in_new' })).resolves.toBeNull();

    await repository.markVoided(first.id);
    const again = await repository.insertPending({ subscriptionId: 'sub_2', invoiceId: 'in_new' });
    expect(again).toMatchObject({ status: 'pending' });
  });

  test('concurrent inserts leave exactly one active row', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => repository.insertPending({ subscriptionId: 'sub_3', invoiceId: 'in_race' })));
    expect(results.filter(Boolean)).toHaveLength(1);
    const [{ total }] = await dataSource.query("SELECT COUNT(*) AS total FROM ups_shipments WHERE stripe_invoice_id = 'in_race'");
    expect(Number(total)).toBe(1);
  });

  test('down removes the index and the column, and up refuses existing duplicates', async () => {
    const migration = new AddUpsShipmentsActiveInvoiceUnique1700000000030();
    await migration.down(runner);
    expect(await runner.hasColumn('ups_shipments', 'active_invoice_id')).toBe(false);

    await dataSource.query("INSERT INTO ups_shipments (subscription_id, stripe_invoice_id, status) VALUES ('sub_4', 'in_dup', 'created'), ('sub_4', 'in_dup', 'pending')");
    await expect(migration.up(runner)).rejects.toThrow(/in_dup/);
    expect(await runner.hasColumn('ups_shipments', 'active_invoice_id')).toBe(false);
  });
});
