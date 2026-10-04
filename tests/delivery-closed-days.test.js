require('dotenv').config();
const mysql = require('mysql2/promise');
const { DeliveryClosedDaysRepository } = require('../src/infrastructure/repositories/delivery-closed-days.repository');
const {
  TIMEZONE_BR,
  brazilPrepValid,
  dateKey,
  deliveryForPrep,
  ensureBrazilYear,
  insertIgnoringConflict,
  usPrepValid,
  usYearHasCalendar,
  assessUsCalendar,
  weekday,
  wallTimeToUtc
} = require('../src/core/delivery-closed-days');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

function at(year, month, day, hour, timeZone) {
  return wallTimeToUtc(year, month, day, hour, 0, 0, timeZone);
}

describe('delivery closed day generation', () => {
  test('a one_off on an existing date is left in place', () => {
    const existing = [{ market: 'BR', closedOn: '2028-01-01', origin: 'one_off', label: 'Pontual' }];
    const merged = insertIgnoringConflict(existing, [{
      market: 'BR',
      closedOn: '2028-01-01',
      origin: 'fixed',
      label: 'Confraternização Universal'
    }]);
    expect(merged.filter((item) => item.closedOn === '2028-01-01')).toEqual([existing[0]]);
    const generated = ensureBrazilYear(existing, 2028);
    expect(generated.rows.find((item) => item.closedOn === '2028-01-01').origin).toBe('one_off');
    expect(generated.rows.some((item) => item.origin === 'fixed')).toBe(true);
    expect(ensureBrazilYear(generated.rows, 2028).generated).toBe(false);
  });
});

describeIntegration('delivery closed days read from MySQL', () => {
  let connection;
  let repository;

  beforeAll(async () => {
    connection = await mysql.createConnection({
      host: process.env.INTEGRATION_DB_HOST || process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.INTEGRATION_DB_PORT || process.env.DB_PORT || 3310),
      user: process.env.INTEGRATION_DB_USER || process.env.DB_USER || 'eden_bowls',
      password: process.env.INTEGRATION_DB_PASSWORD || process.env.DB_PASSWORD || 'eden_bowls',
      database: process.env.INTEGRATION_DB_NAME || process.env.DB_NAME || 'eden_bowls'
    });
    repository = new DeliveryClosedDaysRepository({
      query: (sql, params) => connection.query(sql, params).then(([rows]) => rows)
    });
  });

  afterAll(async () => {
    if (connection) {
      await connection.query(
        "DELETE FROM delivery_closed_days WHERE market = 'US' AND closed_on = '2026-12-22' AND origin = 'one_off'"
      );
      await connection.query(
        "DELETE FROM delivery_closed_days WHERE market = 'BR' AND closed_on >= '2028-01-01' AND closed_on < '2029-01-01'"
      );
      await connection.end();
    }
  });

  test('seeded rows drive the projection', async () => {
    const rows = await repository.listActive();
    expect(rows.some((item) => item.closedOn === '2026-02-16' && item.closesPreparation)).toBe(true);
    expect(rows.some((item) => item.closedOn === '2026-02-17')).toBe(true);
    expect(rows.some((item) => item.closedOn === '2026-04-03')).toBe(true);
    expect(rows.some((item) => item.closedOn === '2026-06-04')).toBe(true);
    expect(rows.some((item) => item.closedOn === '2027-02-08')).toBe(true);
    expect(rows.some((item) => item.closedOn === '2027-02-09')).toBe(true);
    expect(rows.some((item) => item.closedOn === '2027-03-26')).toBe(true);
    expect(rows.some((item) => item.closedOn === '2027-05-27')).toBe(true);
    expect(usPrepValid({ year: 2026, month: 12, day: 22 }, rows, 1)).toBe(true);
    expect(dateKey(
      deliveryForPrep('US', { year: 2026, month: 12, day: 22 }, 1).year,
      deliveryForPrep('US', { year: 2026, month: 12, day: 22 }, 1).month,
      deliveryForPrep('US', { year: 2026, month: 12, day: 22 }, 1).day
    )).toBe('2026-12-24');
    expect(usPrepValid({ year: 2026, month: 12, day: 23 }, rows, 1)).toBe(false);
    expect(usPrepValid({ year: 2026, month: 12, day: 30 }, rows, 1)).toBe(false);
    expect(usPrepValid({ year: 2026, month: 11, day: 23 }, rows, 1)).toBe(true);
    expect(usPrepValid({ year: 2026, month: 11, day: 24 }, rows, 1)).toBe(false);
    expect(usPrepValid({ year: 2026, month: 11, day: 25 }, rows, 1)).toBe(false);
    expect(usPrepValid({ year: 2026, month: 6, day: 4 }, rows, 1)).toBe(false);
    const eve = rows.find((item) => item.closedOn === '2026-12-24');
    const nye = rows.find((item) => item.closedOn === '2026-12-31');
    expect(eve).toMatchObject({ closesPreparation: false, closesPickup: true, closesDelivery: false });
    expect(nye).toMatchObject({ closesPreparation: false, closesPickup: true, closesDelivery: true });
    expect(usYearHasCalendar(rows, 2027)).toBe(false);
    const { brazilPrepValid: prepValid } = require('../src/core/delivery-closed-days');
    expect(prepValid({ year: 2026, month: 2, day: 16 }, rows)).toBe(false);
    expect(prepValid({ year: 2026, month: 2, day: 17 }, rows)).toBe(false);
    expect(prepValid({ year: 2026, month: 1, day: 4 }, rows)).toBe(false);
    expect(prepValid({ year: 2026, month: 1, day: 5 }, rows)).toBe(true);
    expect(prepValid({ year: 2026, month: 1, day: 10 }, rows)).toBe(true);
    const nov23 = deliveryForPrep('US', { year: 2026, month: 11, day: 23 }, 1);
    expect(dateKey(nov23.year, nov23.month, nov23.day)).toBe('2026-11-25');
    const logger = { warn: jest.fn() };
    assessUsCalendar(rows, 2027, logger);
    assessUsCalendar(rows, 2030, logger);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(rows.some((item) => item.closedOn === '2027-01-01' && item.closesDelivery)).toBe(true);
    expect(usPrepValid({ year: 2027, month: 1, day: 18 }, rows, 1)).toBe(true);
    expect(weekday(2030, 1, 5)).toBe(6);
    expect(usPrepValid({ year: 2030, month: 1, day: 5 }, rows, 1)).toBe(false);
    expect(usPrepValid({ year: 2030, month: 1, day: 8 }, rows, 1)).toBe(true);
    const charge = at(2026, 1, 3, 14, TIMEZONE_BR);
    const { firstPrepDay } = require('../src/core/delivery-closed-days');
    const prep = firstPrepDay('BR', charge, rows, 0);
    expect(dateKey(prep.year, prep.month, prep.day)).toBe('2026-01-05');
  });

  test('a new United States one_off changes the projection without a code change', async () => {
    const before = await repository.listActive();
    expect(usPrepValid({ year: 2026, month: 12, day: 22 }, before, 1)).toBe(true);
    await repository.insertIgnore({
      market: 'US',
      closedOn: '2026-12-22',
      label: 'Fechamento pontual',
      origin: 'one_off',
      closesPreparation: true,
      closesPickup: true,
      closesDelivery: true
    });
    const after = await repository.listActive();
    expect(usPrepValid({ year: 2026, month: 12, day: 22 }, after, 1)).toBe(false);
    await repository.deleteOne('US', '2026-12-22');
    const restored = await repository.listActive();
    expect(usPrepValid({ year: 2026, month: 12, day: 22 }, restored, 1)).toBe(true);
  });

  test('a one_off already stored on 2028-01-01 is left in place', async () => {
    await connection.query(
      "DELETE FROM delivery_closed_days WHERE market = 'BR' AND closed_on >= '2028-01-01' AND closed_on < '2029-01-01'"
    );
    await repository.insertIgnore({
      market: 'BR',
      closedOn: '2028-01-01',
      label: 'Fechamento pontual',
      origin: 'one_off',
      closesPreparation: true,
      closesPickup: false,
      closesDelivery: false
    });
    await repository.ensureBrazilYear(2028);
    const rows = await repository.listActive();
    const january = rows.filter((item) => item.market === 'BR' && item.closedOn === '2028-01-01');
    expect(january).toHaveLength(1);
    expect(january[0].origin).toBe('one_off');
    expect(rows.some((item) => item.closedOn === '2028-12-25' && item.origin === 'fixed')).toBe(true);
  });

  test('a Brazil year with only a one_off still generates national holidays once', async () => {
    await connection.query(
      "DELETE FROM delivery_closed_days WHERE market = 'BR' AND closed_on >= '2028-01-01' AND closed_on < '2029-01-01'"
    );
    await repository.insertIgnore({
      market: 'BR',
      closedOn: '2028-08-10',
      label: 'Ponto facultativo',
      origin: 'one_off',
      closesPreparation: true,
      closesPickup: true,
      closesDelivery: true
    });
    const first = await repository.ensureBrazilYear(2028);
    expect(first.generated).toBe(true);
    const second = await repository.ensureBrazilYear(2028);
    expect(second.generated).toBe(false);
    const rows = await repository.listActive();
    const yearRows = rows.filter((item) => item.market === 'BR' && item.closedOn.startsWith('2028-'));
    expect(yearRows.find((item) => item.closedOn === '2028-08-10').origin).toBe('one_off');
    expect(yearRows.some((item) => item.origin === 'fixed' && item.closedOn === '2028-12-25')).toBe(true);
    expect(yearRows.filter((item) => item.origin === 'fixed' || item.origin === 'movable').length).toBeGreaterThan(10);
  });
});
