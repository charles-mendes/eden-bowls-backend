const { estimateMrr } = require('../src/core/report-mrr');

describe('estimated MRR', () => {
  test('sums active and past due monthly prices in minor units', () => {
    expect(estimateMrr([
      { status: 'active', subtotal: '150.00' },
      { status: 'past_due', subtotal: 89.9 }
    ])).toEqual({ value: 23990, previous: null, estimated: true, trialingSubscriptions: 0, unpricedSubscriptions: 0 });
  });

  test('keeps trialing rows out and counts them', () => {
    const result = estimateMrr([{ status: 'trialing', subtotal: '200' }, { status: 'active', subtotal: '10' }]);
    expect(result.value).toBe(1000);
    expect(result.trialingSubscriptions).toBe(1);
  });

  test('counts rows without a stored price instead of guessing', () => {
    const result = estimateMrr([{ status: 'active', subtotal: null }, { status: 'active', subtotal: 'null' }, { status: 'active', subtotal: '0' }]);
    expect(result).toMatchObject({ value: 0, unpricedSubscriptions: 3 });
  });

  test('rounds each row to cents', () => {
    expect(estimateMrr([{ status: 'active', subtotal: '33.335' }, { status: 'active', subtotal: '0.1' }]).value).toBe(3344);
  });
});
