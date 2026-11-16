const { activeCourierDelivery, courierTimeline } = require('../src/core/courier-timeline');

const paidAt = '2026-11-02 10:00:00';
const reached = (timeline) => timeline.stages.filter((stage) => stage.reached).map((stage) => [stage.key, stage.at]);
const row = (id, status, extra = {}) => ({ id, status, out_for_delivery_at: '2026-11-03 09:00:00', ...extra });

describe('courierTimeline', () => {
  test('Paid with no delivery yet: only preparing is reached', () => {
    const timeline = courierTimeline([], { paidAt });
    expect(timeline).toMatchObject({ carrier: 'courier', current: 'preparing', warning: null, description: null });
    expect(reached(timeline)).toEqual([['preparing', paidAt]]);
    expect(timeline.stages.map((stage) => stage.key)).toEqual(['preparing', 'out_for_delivery', 'delivered']);
  });

  test('On the road: preparing and out for delivery have dates, delivered is pending', () => {
    const timeline = courierTimeline([row(1, 'out_for_delivery')], { paidAt });
    expect(timeline.current).toBe('out_for_delivery');
    expect(reached(timeline)).toEqual([['preparing', paidAt], ['out_for_delivery', '2026-11-03 09:00:00']]);
    expect(timeline.stages[2]).toEqual({ key: 'delivered', reached: false, at: null });
  });

  test('Delivered reaches all three stages', () => {
    const timeline = courierTimeline([row(1, 'delivered', { delivered_at: new Date('2026-11-03T15:00:00Z') })], { paidAt });
    expect(timeline.current).toBe('delivered');
    expect(reached(timeline)[2]).toEqual(['delivered', '2026-11-03T15:00:00.000Z']);
  });

  test('Failed attempt: preparing is current and carries the warning', () => {
    const timeline = courierTimeline([row(1, 'failed', { failure_reason: 'Ninguém em casa' })], { paidAt });
    expect(timeline.current).toBe('preparing');
    expect(timeline.warning).toEqual({ status: 'failed', description: null });
    expect(JSON.stringify(timeline)).not.toContain('Ninguém');
  });

  test('a new attempt after a failure clears the warning', () => {
    const timeline = courierTimeline([row(2, 'out_for_delivery'), row(1, 'failed')], { paidAt });
    expect(timeline.current).toBe('out_for_delivery');
    expect(timeline.warning).toBeNull();
  });

  test('a canceled attempt never shows', () => {
    const timeline = courierTimeline([row(1, 'canceled')], { paidAt });
    expect(timeline.current).toBe('preparing');
    expect(timeline.warning).toBeNull();
  });

  test('activeCourierDelivery ignores failed and canceled rows', () => {
    expect(activeCourierDelivery([row(1, 'failed'), row(2, 'canceled')])).toBeNull();
    expect(activeCourierDelivery([row(1, 'failed'), row(3, 'delivered')]).id).toBe(3);
  });
});
