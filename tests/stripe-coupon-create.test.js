const { StripeCouponService } = require('../src/services/stripe-coupon.service');

describe('StripeCouponService createFirstPurchaseCoupon', () => {
  test('creates a once coupon and maps the slot', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({
        mapping: { 1: null, 3: null, 6: null },
        coupons: { 1: null, 3: null, 6: null }
      }),
      saveMapping: jest.fn().mockResolvedValue(undefined),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const stripe = {
      coupons: {
        create: jest.fn().mockResolvedValue({ id: 'coupon_1' })
      },
      promotionCodes: {
        create: jest.fn().mockResolvedValue({ id: 'promo_created', code: 'FIRST_1M' })
      }
    };
    const service = new StripeCouponService(repository, {
      stripeBilling: { ensureClient: () => stripe }
    });

    const result = await service.createFirstPurchaseCoupon({
      term_months: 1,
      code: 'FIRST_1M',
      assign_first_purchase_slot: true
    });

    expect(stripe.coupons.create).toHaveBeenCalledWith(expect.objectContaining({
      percent_off: 10,
      duration: 'once'
    }));
    expect(stripe.promotionCodes.create).toHaveBeenCalledWith(expect.objectContaining({
      restrictions: { first_time_transaction: true }
    }));
    expect(repository.saveMapping).toHaveBeenCalled();
    expect(result.data.promotion_code_id).toBe('promo_created');
  });
});
