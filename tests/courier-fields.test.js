const {
  parseCost,
  parseCourierDetails,
  parseFailureReason,
  parseMethod,
  parseNote,
  parseTrackingUrl
} = require('../src/core/courier-fields');

const field = (fn) => {
  try {
    fn();
  } catch (error) {
    return { status: error.statusCode, field: error.details && error.details.field };
  }
  return null;
};

describe('parseTrackingUrl', () => {
  test('Valid link is stored as given, trimmed', () => {
    expect(parseTrackingUrl('  https://trip.uber.com/abc123 ')).toBe('https://trip.uber.com/abc123');
  });

  test.each([
    ['http://trip.uber.com/abc'],
    ['https://user:pass@trip.uber.com/abc'],
    ['javascript:alert(1)'],
    ['trip.uber.com/abc'],
    ['https://trip.uber.com/a b'],
    [`https://trip.uber.com/${'a'.repeat(501 - 'https://trip.uber.com/'.length)}`]
  ])('refuses %p with field tracking_url', (value) => {
    expect(field(() => parseTrackingUrl(value))).toEqual({ status: 422, field: 'tracking_url' });
  });

  test('accepts exactly 500 characters, and empty means no link', () => {
    const url = `https://trip.uber.com/${'a'.repeat(500 - 'https://trip.uber.com/'.length)}`;
    expect(parseTrackingUrl(url)).toBe(url);
    expect(parseTrackingUrl('  ')).toBeNull();
    expect(parseTrackingUrl(undefined)).toBeUndefined();
  });
});

describe('parseCost', () => {
  test('18.50 is 1850 centavos', () => {
    expect(parseCost('18.50')).toBe(1850);
    expect(parseCost('18.5')).toBe(1850);
    expect(parseCost('0')).toBe(0);
    expect(parseCost(18.5)).toBe(1850);
    expect(parseCost('0.07')).toBe(7);
  });

  test.each([['-1'], ['18.555'], ['18,50'], ['abc'], ['1e3']])('refuses %p', (value) => {
    expect(field(() => parseCost(value))).toEqual({ status: 422, field: 'cost' });
  });
});

describe('the other fields', () => {
  test('method must be one of the four', () => {
    expect(parseMethod('motoboy')).toBe('motoboy');
    expect(field(() => parseMethod(undefined, { required: true }))).toEqual({ status: 422, field: 'method' });
    expect(field(() => parseMethod('drone'))).toEqual({ status: 422, field: 'method' });
  });

  test('courier name up to 120 and note up to 500', () => {
    expect(field(() => parseCourierDetails({ method: 'uber', courier_name: 'a'.repeat(121) }))).toEqual({ status: 422, field: 'courier_name' });
    expect(parseNote('é'.repeat(500))).toHaveLength(500);
    expect(field(() => parseNote('a'.repeat(501)))).toEqual({ status: 422, field: 'note' });
  });

  test('a failure needs a reason', () => {
    expect(field(() => parseFailureReason('  '))).toEqual({ status: 422, field: 'reason' });
    expect(parseFailureReason(' Ninguém em casa ')).toBe('Ninguém em casa');
  });

  test('details keep only the fields sent', () => {
    expect(parseCourierDetails({ cost: '20' })).toEqual({ costMinor: 2000 });
    expect(parseCourierDetails({ method: 'uber', tracking_url: '', note: 'x' }, { required: true }))
      .toEqual({ method: 'uber', trackingUrl: null, note: 'x' });
  });
});
