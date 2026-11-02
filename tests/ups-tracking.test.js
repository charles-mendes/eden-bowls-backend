const { parseUpsTracking, upsTrackingUrl } = require('../src/core/ups-tracking');

function answer(pkg) {
  return { trackResponse: { shipment: [{ package: [pkg] }] } };
}

function scan(type, description, extra = {}) {
  return answer({
    currentStatus: { description },
    activity: [{ status: { type, description }, date: '20260510', time: '081500' }],
    ...extra
  });
}

describe('parseUpsTracking', () => {
  test('reads a delivery as the UPS sandbox answers it', () => {
    expect(parseUpsTracking(answer({
      currentStatus: { description: 'Delivered', code: '011' },
      deliveryDate: [{ type: 'DEL', date: '20260512' }],
      deliveryTime: { type: 'DEL', endTime: '144653' },
      activity: [{ status: { type: 'D', description: 'DELIVERED ', code: 'FS', statusCode: '011' }, date: '20260512', time: '144653' }]
    }))).toEqual({ status: 'delivered', description: 'Delivered', deliveredAt: '2026-05-12 14:46:53' });
  });

  test('falls back to the scan date when there is no delivery date', () => {
    expect(parseUpsTracking(scan('D', 'Delivered')).deliveredAt).toBe('2026-05-10 08:15:00');
  });

  test.each([
    ['M', 'Shipper created a label', 'label_created'],
    ['P', 'Pickup scan', 'in_transit'],
    ['I', 'Departed from facility', 'in_transit'],
    ['I', 'Out For Delivery Today', 'out_for_delivery'],
    ['X', 'Delivery attempt failed', 'exception'],
    ['RS', 'Returned to shipper', 'unknown']
  ])('maps type %s (%s) to %s', (type, description, status) => {
    expect(parseUpsTracking(scan(type, description))).toEqual({ status, description, deliveredAt: null });
  });

  test.each([[null], [{}], [{ trackResponse: { shipment: [{ warnings: [{}] }] } }]])('returns null without a package: %j', (payload) => {
    expect(parseUpsTracking(payload)).toBeNull();
  });
});

describe('upsTrackingUrl', () => {
  test('builds the public link, and none without a number', () => {
    expect(upsTrackingUrl('1Z 1')).toBe('https://www.ups.com/track?tracknum=1Z%201');
    expect(upsTrackingUrl(null)).toBeNull();
  });
});
