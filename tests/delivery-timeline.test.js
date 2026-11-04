const { deliveryTimeline } = require('../src/core/delivery-timeline');

const label = (extra = {}) => ({ status: 'created', shipped_at: '2026-05-09 12:00:00', ...extra });
const reached = (timeline) => timeline.stages.filter((stage) => stage.reached).map((stage) => [stage.key, stage.at]);

describe('deliveryTimeline', () => {
  test('a new label is at label created', () => {
    const timeline = deliveryTimeline(label({ tracking_status: 'label_created' }));
    expect(timeline.current).toBe('label_created');
    expect(timeline.carrier).toBe('ups');
    expect(reached(timeline)).toEqual([['label_created', '2026-05-09 12:00:00']]);
    expect(timeline.warning).toBeNull();
  });

  test('Shipment in transit: two stages with dates, two pending', () => {
    const timeline = deliveryTimeline(label({ tracking_status: 'in_transit', in_transit_at: '2026-05-10 18:00:00', tracking_description: 'Departed' }));
    expect(timeline.current).toBe('in_transit');
    expect(reached(timeline)).toEqual([['label_created', '2026-05-09 12:00:00'], ['in_transit', '2026-05-10 18:00:00']]);
    expect(timeline.stages.slice(2).every((stage) => !stage.reached && stage.at === null)).toBe(true);
    expect(timeline.description).toBe('Departed');
  });

  test('Stage passed with no scan counts as reached with no date', () => {
    const timeline = deliveryTimeline({ status: 'delivered', shipped_at: '2026-05-09 12:00:00', tracking_status: 'delivered', delivered_at: '2026-05-12 14:46:53' });
    expect(timeline.current).toBe('delivered');
    expect(reached(timeline)).toEqual([
      ['label_created', '2026-05-09 12:00:00'], ['in_transit', null], ['out_for_delivery', null], ['delivered', '2026-05-12 14:46:53']
    ]);
  });

  test('a stage passed with no date still counts from the last status', () => {
    expect(deliveryTimeline(label({ tracking_status: 'out_for_delivery' })).current).toBe('out_for_delivery');
  });

  test.each([['exception', 'Delivery attempt failed'], ['returned', 'Returned to shipper']])('%s is a warning on the current stage', (status, description) => {
    const timeline = deliveryTimeline(label({ tracking_status: status, tracking_description: description, in_transit_at: '2026-05-10 18:00:00' }));
    expect(timeline.current).toBe('in_transit');
    expect(timeline.warning).toEqual({ status, description });
  });

  test('Problem resolved: the warning is gone', () => {
    const timeline = deliveryTimeline(label({ tracking_status: 'out_for_delivery', in_transit_at: '2026-05-10 18:00:00', out_for_delivery_at: '2026-05-12 07:00:00' }));
    expect(timeline.current).toBe('out_for_delivery');
    expect(timeline.warning).toBeNull();
  });

  test('Back at the hub after out for delivery keeps the stage and shows the latest description', () => {
    const timeline = deliveryTimeline(label({
      tracking_status: 'in_transit', tracking_description: 'Arrived at Facility',
      in_transit_at: '2026-05-10 18:00:00', out_for_delivery_at: '2026-05-12 07:00:00'
    }));
    expect(timeline.current).toBe('out_for_delivery');
    expect(timeline.description).toBe('Arrived at Facility');
    expect(timeline.warning).toBeNull();
  });

  test.each(['voided', 'pending', 'unknown'])('no timeline for a %s row', (status) => {
    expect(deliveryTimeline({ status, shipped_at: '2026-05-09 12:00:00' })).toBeNull();
  });
});
