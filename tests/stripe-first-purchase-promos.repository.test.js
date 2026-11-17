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
      ['us', 1, 'promo_1m', 'coupon_1']
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `stripe_first_purchase_promos`'),
      ['us', 6, 'promo_6m', null]
    );
  });

  test('increments the misconfig metric of one Stripe account', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([{ metric_value: 4, updated_at: new Date('2026-09-29T05:42:49Z') }])
    };
    const repository = new StripeFirstPurchasePromosRepository(dataSource);

    await expect(repository.incrementMisconfigCount('br')).resolves.toBe(4);
    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('VALUES (?, 1) ON DUPLICATE KEY UPDATE'),
      ['misconfig_count:br']
    );
  });

  test('reads the count and the date of the last blocked checkout of an account', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ metric_value: 2, updated_at: new Date('2026-09-29T05:42:49Z') }])
    };
    const repository = new StripeFirstPurchasePromosRepository(dataSource);

    await expect(repository.getMisconfig('us')).resolves.toEqual({ count: 2, lastAt: '2026-09-29T05:42:49.000Z' });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('WHERE `metric_key` = ?'), ['misconfig_count:us']);
  });

  test('reads zero and no date when the account has no row', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue([]) };
    const repository = new StripeFirstPurchasePromosRepository(dataSource);

    await expect(repository.getMisconfig('br')).resolves.toEqual({ count: 0, lastAt: null });
  });

  test('resets only the misconfig row of the account', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new StripeFirstPurchasePromosRepository(dataSource);

    await repository.resetMisconfigCount('br');
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM `stripe_first_purchase_promo_metrics` WHERE `metric_key` = ?'),
      ['misconfig_count:br']
    );
  });
});
