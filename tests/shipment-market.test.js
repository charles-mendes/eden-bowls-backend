const { shipmentMarket, shipmentMarketSql, marketExceptionSql } = require('../src/core/shipment-market');

describe('shipmentMarket', () => {
  test.each([
    ['br', { country: 'BR' }, { market: 'BR', exception: false }],
    ['us', { country: 'us' }, { market: 'US', exception: false }],
    ['br', { country: 'US' }, { market: null, exception: true }],
    ['us', { country: 'BR' }, { market: null, exception: true }],
    ['us', { city: 'Austin' }, { market: null, exception: true }],
    ['us', null, { market: null, exception: true }]
  ])('account %p with %p', (stripeAccount, address, expected) => {
    expect(shipmentMarket({ stripeAccount, address })).toEqual(expected);
  });

  test('reads a JSON column as stored', () => {
    expect(shipmentMarket({ stripeAccount: 'BR', address: '{"country":"BR"}' })).toEqual({ market: 'BR', exception: false });
  });
});

describe('shipmentMarketSql', () => {
  test('pairs account and stored country, with no default country', () => {
    expect(shipmentMarketSql('BR')).toContain("q.stripe_account = 'br'");
    expect(shipmentMarketSql('BR')).toContain("= 'BR'");
    expect(shipmentMarketSql('US', 's')).toContain("s.stripe_account = 'us'");
    expect(marketExceptionSql()).toMatch(/^NOT \(/);
  });
});
