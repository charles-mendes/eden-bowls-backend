const {
  buildBrazilHolidayRows,
  currentBrDeliveryDays,
  dateKey,
  deliveryForPrep,
  setBrDeliveryDays,
  wallTimeToUtc,
  TIMEZONE_BR
} = require('../src/core/delivery-closed-days');
const { projectOne } = require('../src/services/customer-deliveries.service');

function key(parts) {
  return dateKey(parts.year, parts.month, parts.day);
}

// 2026-11-13 is a Friday; 2026-11-20 (Consciência Negra) is a Friday holiday that closes delivery.
const FRIDAY = { year: 2026, month: 11, day: 13 };
const THURSDAY_BEFORE_HOLIDAY = { year: 2026, month: 11, day: 19 };

describe('Brazil delivery days (business days after preparation)', () => {
  afterEach(() => setBrDeliveryDays(0));

  test('0, the default, delivers the same day as preparation', () => {
    expect(currentBrDeliveryDays()).toBe(0);
    expect(key(deliveryForPrep('BR', FRIDAY, 0, []))).toBe('2026-11-13');
  });

  test('skips Saturday and Sunday: Friday + 2 business days is Tuesday', () => {
    setBrDeliveryDays(2);
    expect(key(deliveryForPrep('BR', FRIDAY, 0, []))).toBe('2026-11-17');
  });

  test('skips a day that closes delivery', () => {
    setBrDeliveryDays(1);
    const rows = buildBrazilHolidayRows(2026);
    expect(key(deliveryForPrep('BR', THURSDAY_BEFORE_HOLIDAY, 0, rows))).toBe('2026-11-23');

    const closed = [{ market: 'BR', closedOn: '2026-11-16', active: true, closesPreparation: false, closesDelivery: true }];
    setBrDeliveryDays(2);
    expect(key(deliveryForPrep('BR', FRIDAY, 0, closed))).toBe('2026-11-18');
  });

  test('ignores the transit days of the quote: the operator setting rules Brazil', () => {
    setBrDeliveryDays(1);
    expect(key(deliveryForPrep('BR', FRIDAY, 9, []))).toBe('2026-11-16');
  });

  test('a value outside 0 to 3 falls back to the same day', () => {
    for (const value of [4, -1, 1.5, 'two', null]) {
      setBrDeliveryDays(value);
      expect(currentBrDeliveryDays()).toBe(0);
    }
  });

  test('the projected delivery of a charge counts the business days after the preparation day', () => {
    setBrDeliveryDays(3);
    const chargeAt = wallTimeToUtc(2026, 11, 13, 0, 0, 0, TIMEZONE_BR);

    const projected = projectOne('BR', chargeAt, [], 0);

    expect(projected.preparationDay).toBe('2026-11-13');
    expect(projected.deliveryDate).toBe('2026-11-18');
  });
});
