const { resolveDeliveryRange, dayAfter } = require('../src/core/delivery-range');

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
// 2026-11-06 12:00 UTC: 09:00 in São Paulo, 07:00 in New York.
const NOW = new Date('2026-11-06T12:00:00Z');

function refusal(fn) {
  try {
    fn();
  } catch (error) {
    return { status: error.statusCode || error.status, code: error.code || (error.details && error.details.code) };
  }
  return null;
}

describe('resolveDeliveryRange', () => {
  it('defaults to the 30-day floor through tomorrow', () => {
    expect(resolveDeliveryRange({}, { now: NOW, zone: SP })).toEqual({
      from: '2026-10-07', to: '2026-11-07', default: true, floor: '2026-10-07'
    });
  });

  it('accepts the default dates sent explicitly: exactly 31 days', () => {
    expect(resolveDeliveryRange({ from: '2026-10-07', to: '2026-11-07' }, { now: NOW, zone: SP }))
      .toMatchObject({ from: '2026-10-07', to: '2026-11-07', default: false });
  });

  it('refuses 32 days', () => {
    expect(refusal(() => resolveDeliveryRange({ from: '2026-10-07', to: '2026-11-08' }, { now: NOW, zone: SP })))
      .toMatchObject({ status: 400, code: 'invalid_delivery_range' });
  });

  it('keeps a range of the next days', () => {
    expect(resolveDeliveryRange({ from: '2026-11-06', to: '2026-11-12' }, { now: NOW, zone: SP }))
      .toMatchObject({ from: '2026-11-06', to: '2026-11-12', default: false });
  });

  it('fills the missing end', () => {
    expect(resolveDeliveryRange({ from: '2026-11-06' }, { now: NOW, zone: SP })).toMatchObject({ from: '2026-11-06', to: '2026-11-07' });
    expect(resolveDeliveryRange({ to: '2026-11-01' }, { now: NOW, zone: SP })).toMatchObject({ from: '2026-10-07', to: '2026-11-01' });
  });

  it.each([
    ['not a date', { from: '06/11/2026' }],
    ['an impossible date', { to: '2026-02-30' }],
    ['from after to', { from: '2026-11-10', to: '2026-11-09' }],
    ['before the floor', { from: '2026-10-06' }]
  ])('refuses %s', (_label, query) => {
    expect(refusal(() => resolveDeliveryRange(query, { now: NOW, zone: SP }))).toMatchObject({ status: 400, code: 'invalid_delivery_range' });
  });

  it('takes today in the timezone given', () => {
    // 02:00 UTC on the 7th is still the 6th in New York and already the 6th at 23:00 in São Paulo.
    const late = new Date('2026-11-07T02:30:00Z');
    expect(resolveDeliveryRange({}, { now: late, zone: NY }).to).toBe('2026-11-07');
    expect(resolveDeliveryRange({}, { now: late, zone: SP }).to).toBe('2026-11-07');
    const later = new Date('2026-11-07T04:00:00Z');
    expect(resolveDeliveryRange({}, { now: later, zone: SP }).to).toBe('2026-11-08');
    expect(resolveDeliveryRange({}, { now: later, zone: NY }).to).toBe('2026-11-07');
  });

  it('gives the day after a date', () => {
    expect(dayAfter('2026-11-30', SP)).toBe('2026-12-01');
  });
});
