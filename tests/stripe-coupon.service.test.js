const { HttpError } = require('../src/core/http-error');
const { StripeCouponService } = require('../src/services/stripe-coupon.service');

describe('StripeCouponService', () => {
  test('fills empty database slots from env promo ids', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({
        mapping: { 1: 'promo_db_1m', 3: null, 6: null },
        coupons: { 1: 'coupon_1', 3: null, 6: null }
      }),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const service = new StripeCouponService(repository, {
      envMapping: {
        1: 'promo_env_1m',
        3: 'promo_env_3m',
        6: 'not-a-promo'
      }
    });

    await expect(service.getMapping()).resolves.toEqual({
      1: 'promo_db_1m',
      3: 'promo_env_3m',
      6: null
    });
    await expect(service.mappingHealth()).resolves.toEqual({
      complete: false,
      missing_terms: [6],
      mapping: { 1: 'promo_db_1m', 3: 'promo_env_3m', 6: null },
      misconfig_count: 0
    });
  });

  test('persists only promo_ ids', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({
        mapping: { 1: 'promo_saved', 3: null, 6: null },
        coupons: { 1: null, 3: null, 6: null }
      }),
      saveMapping: jest.fn().mockResolvedValue(undefined),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const service = new StripeCouponService(repository);

    await service.saveMapping({ 1: 'promo_saved', 3: 'coupon_bad', 6: '' });

    expect(repository.saveMapping).toHaveBeenCalledWith({ 1: 'promo_saved' }, {});
  });

  test('returns null for ineligible checkout without reading the map', async () => {
    const repository = {
      getMapping: jest.fn(),
      incrementMisconfigCount: jest.fn()
    };
    const service = new StripeCouponService(repository);

    await expect(service.resolveFirstPurchasePromotionForCheckout({
      eligible: false,
      termMonths: 3
    })).resolves.toBeNull();
    expect(repository.getMapping).not.toHaveBeenCalled();
    expect(repository.incrementMisconfigCount).not.toHaveBeenCalled();
  });

  test('resolves the mapped promotion for an eligible term', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({
        mapping: { 1: null, 3: 'promo_3m', 6: null },
        coupons: { 1: null, 3: null, 6: null }
      })
    };
    const service = new StripeCouponService(repository);

    await expect(service.resolveFirstPurchasePromotionForCheckout({
      eligible: true,
      termMonths: 3
    })).resolves.toEqual({
      promotion_code_id: 'promo_3m',
      discount_percent: 25,
      discount_duration: 'once'
    });
  });

  test('throws 503 and increments the misconfig metric when the slot is empty', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({
        mapping: { 1: null, 3: null, 6: null },
        coupons: { 1: null, 3: null, 6: null }
      }),
      incrementMisconfigCount: jest.fn().mockResolvedValue(1)
    };
    const service = new StripeCouponService(repository);

    await expect(service.resolveFirstPurchasePromotionForCheckout({
      eligible: true,
      termMonths: 1
    })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: 'first_purchase_promo_not_configured' }
    });
    expect(repository.incrementMisconfigCount).toHaveBeenCalledTimes(1);
  });

  test('throws 503 without incrementing when the term is invalid', async () => {
    const repository = {
      getMapping: jest.fn(),
      incrementMisconfigCount: jest.fn()
    };
    const service = new StripeCouponService(repository);

    await expect(service.resolveFirstPurchasePromotionForCheckout({
      eligible: true,
      termMonths: 12
    })).rejects.toBeInstanceOf(HttpError);
    expect(repository.incrementMisconfigCount).not.toHaveBeenCalled();
  });
});
