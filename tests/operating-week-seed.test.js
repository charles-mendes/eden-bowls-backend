const {
  DEFAULT_OPERATING_WEEK,
  TIMEZONE_BR,
  TIMEZONE_US,
  buildSeedRows,
  dateKey,
  deliveryForPrep,
  firstPrepDay,
  wallTimeToUtc
} = require('../src/core/delivery-closed-days');
const { weekFromRows } = require('../src/infrastructure/repositories/operating-week.repository');
const { CreateDeliveryOperatingWeek1700000000081 } = require('../src/infrastructure/migrations/1700000000081-create-delivery-operating-week');

// The deploy invariant (delivery-calendar): with the week the migration seeds, no scheduled delivery is postponed.
// `before` is what the code projected before the standard week, written by hand: the first valid day whose local
// midnight is at or after the charge. Renewals charged before closing on an open day move to their charge day.
const SCHEDULED = [
  { name: 'BR renewal on Tuesday at 14:30', market: 'BR', at: [2026, 11, 17, 14, 30], transit: 0, before: ['2026-11-18', '2026-11-18'], after: ['2026-11-17', '2026-11-17'] },
  { name: 'BR renewal on Friday at 14:30', market: 'BR', at: [2026, 11, 13, 14, 30], transit: 0, before: ['2026-11-14', '2026-11-14'], after: ['2026-11-13', '2026-11-13'] },
  { name: 'BR charge at 00:00 on a Saturday', market: 'BR', at: [2026, 11, 14, 0, 0], transit: 0, before: ['2026-11-14', '2026-11-14'], after: ['2026-11-14', '2026-11-14'] },
  { name: 'BR renewal on Saturday at 21:00', market: 'BR', at: [2026, 11, 14, 21, 0], transit: 0, before: ['2026-11-16', '2026-11-16'], after: ['2026-11-16', '2026-11-16'] },
  { name: 'US renewal on Tuesday at 14:30', market: 'US', at: [2026, 11, 17, 14, 30], transit: 1, before: ['2026-11-18', '2026-11-20'], after: ['2026-11-17', '2026-11-19'] },
  { name: 'US charge at 00:00 on a Monday', market: 'US', at: [2026, 11, 16, 0, 0], transit: 1, before: ['2026-11-16', '2026-11-18'], after: ['2026-11-16', '2026-11-18'] }
];

async function seededWeek() {
  const runner = { hasTable: async () => false, createTable: async () => undefined, query: jest.fn(async () => undefined) };
  await new CreateDeliveryOperatingWeek1700000000081().up(runner);
  const [, params] = runner.query.mock.calls[0];
  const rows = [];
  for (let index = 0; index < params.length; index += 3) {
    rows.push({ market: params[index], weekday: params[index + 1], open: params[index + 2], opens_at: '09:00:00', closes_at: '20:00:00' });
  }
  return { BR: weekFromRows('BR', rows), US: weekFromRows('US', rows) };
}

function project(market, at, calendar, transit) {
  const [y, m, d, h, min] = at;
  const chargeAt = wallTimeToUtc(y, m, d, h, min, 0, market === 'BR' ? TIMEZONE_BR : TIMEZONE_US);
  const prep = firstPrepDay(market, chargeAt, calendar, transit);
  const delivery = deliveryForPrep(market, prep, transit, calendar);
  return [dateKey(prep.year, prep.month, prep.day), dateKey(delivery.year, delivery.month, delivery.day)];
}

describe('the seeded week on deploy', () => {
  test('the migration seeds the default week the rules read', async () => {
    expect(await seededWeek()).toEqual(DEFAULT_OPERATING_WEEK);
  });

  test.each(SCHEDULED)('$name: never later than before; prepared on $after.0', async ({ market, at, transit, before, after }) => {
    const calendar = { rows: buildSeedRows(), week: await seededWeek() };
    const projected = project(market, at, calendar, transit);
    expect(projected).toEqual(after);
    expect(projected[0] <= before[0]).toBe(true);
    expect(projected[1] <= before[1]).toBe(true);
  });
});
