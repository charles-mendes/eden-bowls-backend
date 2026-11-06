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
    }))).toEqual({
      status: 'delivered',
      description: 'Delivered',
      deliveredAt: '2026-05-12 14:46:53',
      stages: { in_transit: null, out_for_delivery: null, delivered: '2026-05-12 14:46:53' }
    });
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
    ['RS', 'Returned to shipper', 'returned']
  ])('maps type %s (%s) to %s', (type, description, status) => {
    expect(parseUpsTracking(scan(type, description))).toMatchObject({ status, description, deliveredAt: null });
  });

  const at = (type, date, time, extra = {}) => ({ status: { type, description: extra.description || type, ...extra }, date, time });

  test('Out for delivery uses the UPS scan code, and a scheduled date is not a delivery', () => {
    const result = parseUpsTracking(answer({
      currentStatus: { description: 'Loaded on Delivery Vehicle', type: 'I' },
      deliveryDate: [{ type: 'SDD', date: '20260512' }],
      activity: [
        at('I', '20260512', '070000', { code: 'OF', statusCode: '072', description: 'Loaded on Delivery Vehicle' }),
        at('I', '20260511', '210000', { code: 'AR', statusCode: '005', description: 'Arrived at Facility' })
      ]
    }));
    expect(result).toMatchObject({ status: 'out_for_delivery', deliveredAt: null });
    expect(result.stages).toEqual({ in_transit: '2026-05-11 21:00:00', out_for_delivery: '2026-05-12 07:00:00', delivered: null });
  });

  test('a status code alone marks out for delivery', () => {
    const result = parseUpsTracking(answer({ activity: [at('I', '20260512', '070000', { statusCode: '072', description: 'Chargé' })] }));
    expect(result.status).toBe('out_for_delivery');
  });

  test('One delivered read contains earlier scans, in any order', () => {
    const result = parseUpsTracking(answer({
      currentStatus: { description: 'Delivered' },
      activity: [
        at('I', '20260511', '090000', { description: 'Departed' }),
        at('D', '20260512', '144653', { description: 'DELIVERED' }),
        at('M', '20260509', '120000', { description: 'Shipper created a label' }),
        at('P', '20260510', '180000', { description: 'Pickup Scan' })
      ]
    }));
    expect(result.status).toBe('delivered');
    expect(result.stages).toEqual({ in_transit: '2026-05-10 18:00:00', out_for_delivery: null, delivered: '2026-05-12 14:46:53' });
  });

  test('Returned to shipper after transit is a warning and keeps the transit date', () => {
    const result = parseUpsTracking(answer({
      activity: [
        at('RS', '20260513', '100000', { description: 'Returned to shipper' }),
        at('I', '20260511', '090000', { description: 'Departed' })
      ]
    }));
    expect(result).toMatchObject({ status: 'returned', description: 'Returned to shipper' });
    expect(result.stages).toEqual({ in_transit: '2026-05-11 09:00:00', out_for_delivery: null, delivered: null });
  });

  test('keeps the English text as a fallback', () => {
    expect(parseUpsTracking(scan('I', 'Out For Delivery Today')).stages.out_for_delivery).toBe('2026-05-10 08:15:00');
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
