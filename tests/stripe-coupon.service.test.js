const { HttpError } = require('../src/core/http-error');
const { StripeCouponService } = require('../src/services/stripe-coupon.service');

describe('StripeCouponService', () => {
  test('reads mapping only from the database', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({
        mapping: { 1: 'promo_db_1m', 3: null, 6: null },
        coupons: { 1: 'coupon_1', 3: null, 6: null }
      }),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const service = new StripeCouponService(repository);

    await expect(service.getMapping()).resolves.toEqual({
      1: 'promo_db_1m',
      3: null,
      6: null
    });
    await expect(service.mappingHealth()).resolves.toEqual({
      complete: false,
      missing_terms: [3, 6],
      mapping: { 1: 'promo_db_1m', 3: null, 6: null },
      misconfig_count: 0
    });
  });

  test('seeds leftover env ids only into empty database slots', async () => {
    const repository = {
      getMapping: jest.fn()
        .mockResolvedValueOnce({
          mapping: { 1: 'promo_db_1m', 3: null, 6: null },
          coupons: { 1: 'coupon_1', 3: null, 6: null }
        })
        .mockResolvedValue({
          mapping: { 1: 'promo_db_1m', 3: 'promo_env_3m', 6: null },
          coupons: { 1: 'coupon_1', 3: null, 6: null }
        }),
      saveMapping: jest.fn().mockResolvedValue(undefined),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const service = new StripeCouponService(repository);

    await service.seedEmptySlots({
      1: 'promo_env_1m',
      3: 'promo_env_3m',
      6: 'not-a-promo'
    });

    expect(repository.saveMapping).toHaveBeenCalledWith({ 3: 'promo_env_3m' }, {});
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

  test('validates mapped promo ids against Stripe before saving', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({
        mapping: { 1: 'promo_saved', 3: null, 6: null },
        coupons: { 1: null, 3: null, 6: null }
      }),
      saveMapping: jest.fn().mockResolvedValue(undefined),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const stripe = {
      promotionCodes: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'promo_saved',
          active: true,
          coupon: { id: 'coupon_saved' }
        })
      }
    };
    const service = new StripeCouponService(repository, {
      stripeBilling: { ensureClient: () => stripe }
    });

    await service.saveMapping({ 1: 'promo_saved' });

    expect(stripe.promotionCodes.retrieve).toHaveBeenCalledWith('promo_saved', { expand: ['coupon'] });
    expect(repository.saveMapping).toHaveBeenCalledWith({ 1: 'promo_saved' }, { 1: 'coupon_saved' });
  });

  test('syncs empty slots from Stripe first-purchase promotion codes', async () => {
    const repository = {
      getMapping: jest.fn()
        .mockResolvedValueOnce({
          mapping: { 1: 'promo_stored_1m', 3: null, 6: null },
          coupons: { 1: null, 3: null, 6: null }
        })
        .mockResolvedValue({
          mapping: { 1: 'promo_stored_1m', 3: 'promo_stripe_3m', 6: null },
          coupons: { 1: 'coupon_1', 3: 'coupon_3', 6: null }
        }),
      saveMapping: jest.fn().mockResolvedValue(undefined),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const stripe = {
      promotionCodes: {
        list: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'promo_stripe_3m',
              active: true,
              created: 20,
              coupon: { id: 'coupon_3', percent_off: 25, duration: 'once' },
              restrictions: { first_time_transaction: true },
              metadata: { pawbowl_purpose: 'first_purchase', pawbowl_term_months: '3' }
            }
          ]
        }),
        retrieve: jest.fn().mockResolvedValue({
          id: 'promo_stored_1m',
          active: true,
          coupon: { id: 'coupon_1', percent_off: 10, duration: 'once' }
        })
      }
    };
    const service = new StripeCouponService(repository, {
      stripeBilling: { ensureClient: () => stripe }
    });

    const result = await service.syncFirstPurchasePromos();

    expect(repository.saveMapping).toHaveBeenCalledWith(
      { 1: 'promo_stored_1m', 3: 'promo_stripe_3m' },
      { 1: 'coupon_1', 3: 'coupon_3' }
    );
    expect(result.slots[1].source).toBe('stored');
    expect(result.slots[3].source).toBe('stripe');
    expect(result.missing_in_stripe).toEqual([]);
  });

  test('lists recent promotion codes with coupon, percent and duration', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({
        mapping: { 1: 'promo_1m', 3: null, 6: null },
        coupons: { 1: 'coupon_1', 3: null, 6: null }
      })
    };
    const stripe = {
      promotionCodes: {
        list: jest.fn().mockResolvedValue({
          data: [
            { id: 'promo_1m', code: 'FIRST_1M', active: true, coupon: 'coupon_1' }
          ]
        })
      },
      coupons: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'coupon_1',
          percent_off: 10,
          duration: 'once'
        })
      }
    };
    const service = new StripeCouponService(repository, {
      stripeBilling: { ensureClient: () => stripe }
    });

    const result = await service.listRecentPromotionCodes(25);

    expect(stripe.coupons.retrieve).toHaveBeenCalledWith('coupon_1');
    expect(result.data.items[0]).toMatchObject({
      id: 'promo_1m',
      code: 'FIRST_1M',
      coupon_id: 'coupon_1',
      percent_off: 10,
      duration: 'once',
      slot: 1
    });
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
