const { StripeFirstPurchasePromosRepository } = require('../src/infrastructure/repositories/stripe-first-purchase-promos.repository');

describe('StripeFirstPurchasePromosRepository', () => {
  test('reads promo ids that start with promo_', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([
        { term_months: 1, promotion_code_id: 'promo_1m', coupon_id: 'coupon_1' },
        { term_months: 3, promotion_code_id: 'bad', coupon_id: null },
        { term_months: 12, promotion_code_id: 'promo_12m', coupon_id: null }
      ])
    };
    const repository = new StripeFirstPurchasePromosRepository(dataSource);

    await expect(repository.getMapping()).resolves.toEqual({
      mapping: { 1: 'promo_1m', 3: null, 6: null },
      coupons: { 1: 'coupon_1', 3: null, 6: null }
    });
  });

  test('persists only valid promo slots', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new StripeFirstPurchasePromosRepository(dataSource);

    await repository.saveMapping({ 1: 'promo_1m', 3: 'coupon_x', 6: 'promo_6m' }, { 1: 'coupon_1' });

    expect(dataSource.query).toHaveBeenCalledTimes(2);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `stripe_first_purchase_promos`'),
      [1, 'promo_1m', 'coupon_1']
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `stripe_first_purchase_promos`'),
      [6, 'promo_6m', null]
    );
  });

  test('increments the misconfig metric', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([{ metric_value: 4 }])
    };
    const repository = new StripeFirstPurchasePromosRepository(dataSource);

    await expect(repository.incrementMisconfigCount()).resolves.toBe(4);
    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("VALUES ('misconfig_count', 1) ON DUPLICATE KEY UPDATE")
    );
  });
});
