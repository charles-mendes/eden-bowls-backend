const { DataSource } = require('typeorm');
const { CreateBlingNfe1700000000057 } = require('../../src/infrastructure/migrations/1700000000057-create-bling-nfe');
const { AddBlingNfeEmail1700000000058 } = require('../../src/infrastructure/migrations/1700000000058-add-bling-nfe-email');
const { AddNfeMissingFields1700000000067 } = require('../../src/infrastructure/migrations/1700000000067-add-nfe-missing-fields');
const { BlingNfeRepository } = require('../../src/infrastructure/repositories/bling-nfe.repository');

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

describeIntegration('migration 1700000000067 stores what a blocked note is missing (MySQL)', () => {
  const database = `it_${Date.now()}_mig067`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreateBlingNfe1700000000057().up(runner);
    await new AddBlingNfeEmail1700000000058().up(runner);
    await new AddNfeMissingFields1700000000067().up(runner);
    await new AddNfeMissingFields1700000000067().up(runner);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('a blocked note keeps its missing fields, and down drops the column', async () => {
    const repository = new BlingNfeRepository(dataSource);
    const row = await repository.insertOrGet({
      status: 'blocked_missing_document',
      userId: 7,
      stripeAccount: 'br',
      stripeSubscriptionId: 'sub_1',
      stripeInvoiceId: 'in_1',
      totalMinor: 15000,
      currency: 'brl',
      customerName: null,
      customerEmail: 'ana@example.com',
      customerDocument: '52998224725',
      customerAddress: { city: 'Curitiba' },
      missingFields: ['fiscal_name'],
      nextAttemptAt: null
    });
    expect(row.missingFields).toEqual(['fiscal_name']);

    await repository.update(row.id, { missingFields: [] });
    expect((await repository.findById(row.id)).missingFields).toEqual([]);

    await new AddNfeMissingFields1700000000067().down(runner);
    const [column] = await dataSource.query(
      "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bling_nfe' AND COLUMN_NAME = 'missing_fields'"
    );
    expect(Number(column.total)).toBe(0);
  });

  test('findCustomer reads the address of the note subscription and the fiscal metas, never the display name', async () => {
    await dataSource.query('CREATE TABLE `wp_users` (`ID` BIGINT PRIMARY KEY, `user_email` VARCHAR(100), `display_name` VARCHAR(250))');
    await dataSource.query('CREATE TABLE `wp_usermeta` (`umeta_id` BIGINT AUTO_INCREMENT PRIMARY KEY, `user_id` BIGINT, `meta_key` VARCHAR(255), `meta_value` LONGTEXT)');
    await dataSource.query('CREATE TABLE `stripe_subscriptions` (`stripe_subscription_id` VARCHAR(64) PRIMARY KEY, `address` JSON NULL)');
    await dataSource.query("INSERT INTO `wp_users` VALUES (7, 'ana@example.com', 'Aninha')");
    await dataSource.query("INSERT INTO `wp_usermeta` (`user_id`, `meta_key`, `meta_value`) VALUES (7, '_eden_tax_document', '52998224725'), (7, '_eden_fiscal_name', 'Ana Antiga'), (7, '_eden_fiscal_name', 'Ana Costa')");
    await dataSource.query(
      "INSERT INTO `stripe_subscriptions` VALUES ('sub_old', ?), ('sub_new', ?)",
      [JSON.stringify({ city: 'Curitiba' }), JSON.stringify({ city: 'Londrina' })]
    );
    const repository = new BlingNfeRepository(dataSource);

    expect(await repository.findCustomer(7, 'sub_new')).toEqual({
      name: 'Ana Costa',
      email: 'ana@example.com',
      taxDocument: '52998224725',
      address: { city: 'Londrina' }
    });

    await dataSource.query("DELETE FROM `wp_usermeta` WHERE `meta_key` = '_eden_fiscal_name'");
    const withoutName = await repository.findCustomer(7, 'sub_old');
    expect(withoutName.name).toBe('');
    expect(withoutName.address).toEqual({ city: 'Curitiba' });
    expect(await repository.findCustomer(99, 'sub_old')).toBeNull();
  });
});
