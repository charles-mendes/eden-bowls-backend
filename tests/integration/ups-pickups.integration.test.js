const { DataSource } = require('typeorm');
const { ExtendUsShippingAndCreateUpsShipments1700000000013 } = require('../../src/infrastructure/migrations/1700000000013-extend-us-shipping-and-create-ups-shipments');
const { AddUpsShipmentTracking1700000000059 } = require('../../src/infrastructure/migrations/1700000000059-add-ups-shipment-tracking');
const { AddUpsShipmentStages1700000000062 } = require('../../src/infrastructure/migrations/1700000000062-add-ups-shipment-stages');
const { CreateUpsPickups1700000000068 } = require('../../src/infrastructure/migrations/1700000000068-create-ups-pickups');
const { UpsPickupRepository } = require('../../src/infrastructure/repositories/ups-pickup.repository');
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

describeIntegration('ups_pickups (MySQL)', () => {
  const database = `it_${Date.now()}_mig068`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;
  let pickups;
  let shipments;
  const reserve = (shipmentIds, overrides = {}) => pickups.reserve({
    pickupDate: '2026-11-09', readyTime: '14:00', closeTime: '18:00', packageCount: shipmentIds.length, shipmentIds, requestedBy: 'ops', ...overrides
  });
  async function label(invoice, status = 'created') {
    const result = await dataSource.query('INSERT INTO ups_shipments (subscription_id, stripe_invoice_id, status) VALUES (?, ?, ?)', ['sub', invoice, status]);
    return Number(result.insertId);
  }
  const pickupOf = async (id) => {
    const value = (await dataSource.query('SELECT pickup_id FROM ups_shipments WHERE id = ?', [id]))[0].pickup_id;
    return value == null ? null : Number(value);
  };

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database, extra: { connectionLimit: 4 } });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new ExtendUsShippingAndCreateUpsShipments1700000000013().up(runner);
    await new AddUpsShipmentTracking1700000000059().up(runner);
    await new AddUpsShipmentStages1700000000062().up(runner);
    await new CreateUpsPickups1700000000068().up(runner);
    await new CreateUpsPickups1700000000068().up(runner);
    pickups = new UpsPickupRepository(dataSource);
    shipments = new UpsShipmentRepository(dataSource);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('a partial reservation undoes everything', async () => {
    const free = await label('in_a');
    const voided = await label('in_b', 'voided');

    const result = await reserve([free, voided]);

    expect(result).toEqual({ pickup: null, ineligibleIds: [voided] });
    expect(await pickupOf(free)).toBeNull();
    const [{ total }] = await dataSource.query('SELECT COUNT(*) AS total FROM ups_pickups');
    expect(Number(total)).toBe(0);
  });

  test('a box UPS already scanned cannot join', async () => {
    const scanned = await label('in_scan');
    await dataSource.query('UPDATE ups_shipments SET in_transit_at = CURRENT_TIMESTAMP WHERE id = ?', [scanned]);
    expect(await reserve([scanned])).toEqual({ pickup: null, ineligibleIds: [scanned] });
  });

  test('a reservation left pending closes only once old enough', async () => {
    const id = await label('in_stale');
    const { pickup } = await reserve([id]);
    expect(await pickups.close(pickup.id, { fromStatus: 'unknown', toStatus: 'not_created', pendingBefore: new Date(Date.now() - 5 * 60 * 1000) })).toBe(false);
    await dataSource.query('UPDATE ups_pickups SET created_at = CURRENT_TIMESTAMP - INTERVAL 10 MINUTE WHERE id = ?', [pickup.id]);
    expect(await pickups.close(pickup.id, { fromStatus: 'unknown', toStatus: 'not_created', pendingBefore: new Date(Date.now() - 5 * 60 * 1000) })).toBe(true);
    expect(await pickupOf(id)).toBeNull();
  });

  test('two reservations at the same time: one wins', async () => {
    const ids = [await label('in_c'), await label('in_d')];

    const results = await Promise.all([reserve(ids), reserve(ids), reserve(ids)]);

    const winners = results.filter((item) => item.pickup);
    expect(winners).toHaveLength(1);
    expect(await pickupOf(ids[0])).toBe(winners[0].pickup.id);
    const [{ total }] = await dataSource.query('SELECT COUNT(*) AS total FROM ups_pickups WHERE JSON_CONTAINS(shipment_ids, ?)', [JSON.stringify(ids[0])]);
    expect(Number(total)).toBe(1);
  });

  test('requested, then canceled, frees the labels; the count of labels without pickup follows', async () => {
    const id = await label('in_e');
    const { pickup } = await reserve([id]);
    await pickups.markRequested(pickup.id, { prn: '2929602E9CP', rawResponse: { ok: true } });

    expect((await pickups.listActiveByIds([pickup.id]))[0]).toMatchObject({ status: 'requested', prn: '2929602E9CP', pickup_date: '2026-11-09' });
    const before = await shipments.countCreatedWithoutPickup();

    expect(await pickups.close(pickup.id, { fromStatus: 'requested', toStatus: 'canceled', closedBy: 'ops' })).toBe(true);
    expect(await pickups.close(pickup.id, { fromStatus: 'requested', toStatus: 'canceled', closedBy: 'ops' })).toBe(false);
    expect(await pickupOf(id)).toBeNull();
    expect(await pickups.listActiveByIds([pickup.id])).toEqual([]);
    expect(await shipments.countCreatedWithoutPickup()).toBe(before + 1);
  });

  test('a refused reservation is deleted and an unknown one keeps its labels', async () => {
    const refusedLabel = await label('in_f');
    const refused = (await reserve([refusedLabel])).pickup;
    await pickups.deleteReservation(refused.id);
    expect(await pickups.findById(refused.id)).toBeNull();
    expect(await pickupOf(refusedLabel)).toBeNull();

    const unknownLabel = await label('in_g');
    const unknown = (await reserve([unknownLabel])).pickup;
    await pickups.markUnknown(unknown.id, 'ups_timeout');
    expect((await reserve([unknownLabel])).ineligibleIds).toEqual([unknownLabel]);
    expect(await pickups.close(unknown.id, { fromStatus: 'unknown', toStatus: 'not_created', closedBy: 'ops' })).toBe(true);
    expect(await pickupOf(unknownLabel)).toBeNull();
  });
});
