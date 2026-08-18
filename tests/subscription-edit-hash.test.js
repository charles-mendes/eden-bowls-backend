const { buildCurrentHash } = require('../src/core/subscription-edit-hash');

describe('subscription-edit-hash', () => {
  test('returns the same hash for the same current state', () => {
    const payload = {
      items: [{ price: 'price_a', quantity: 2 }],
      termMonths: 1,
      address: { country: 'US', state: 'CA' },
      shipping: { cost: 12.9 }
    };

    expect(buildCurrentHash(payload)).toBe(buildCurrentHash({
      shipping: { cost: 12.9 },
      address: { state: 'CA', country: 'US' },
      termMonths: 1,
      items: [{ quantity: 2, price: 'price_a' }]
    }));
  });

  test('changes when the term changes', () => {
    const base = {
      items: [{ price: 'price_a', quantity: 1 }],
      address: {},
      shipping: {}
    };

    expect(buildCurrentHash({ ...base, termMonths: 1 })).not.toBe(buildCurrentHash({ ...base, termMonths: 3 }));
  });
});
