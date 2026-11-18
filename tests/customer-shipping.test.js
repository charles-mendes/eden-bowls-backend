const { customerShipping, isShippingWaived } = require('../src/core/customer-shipping');

describe('customerShipping', () => {
  test('US with charges off: the customer pays 0 and the quote is the company cost', () => {
    expect(customerShipping({ market: 'US', quote: 18.4, chargeEnabled: false })).toEqual({
      original_amount: 18.4,
      charged_amount: 0,
      charge_enabled: false,
      company_cost: 18.4
    });
  });

  test('US with charges on: the customer pays the quote', () => {
    expect(customerShipping({ market: 'US', quote: 18.4, chargeEnabled: true })).toEqual({
      original_amount: 18.4,
      charged_amount: 18.4,
      charge_enabled: true,
      company_cost: null
    });
  });

  test('US without a stored switch reads as off', () => {
    expect(customerShipping({ market: 'us', quote: '14.50' }).charged_amount).toBe(0);
  });

  test('BR: original and charged are the same fee, whatever the US switch', () => {
    expect(customerShipping({ market: 'BR', quote: 15, chargeEnabled: false })).toEqual({
      original_amount: 15,
      charged_amount: 15,
      charge_enabled: true,
      company_cost: null
    });
  });

  test('an invalid quote is 0', () => {
    expect(customerShipping({ market: 'US', quote: 'abc', chargeEnabled: true }).original_amount).toBe(0);
  });

  test('isShippingWaived reads metadata strings and booleans', () => {
    expect(isShippingWaived('true')).toBe(true);
    expect(isShippingWaived(true)).toBe(true);
    expect(isShippingWaived('false')).toBe(false);
    expect(isShippingWaived(undefined)).toBe(false);
  });
});
