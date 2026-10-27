const { HttpError } = require('../src/core/http-error');
const { StripeCouponService, termFromStripePromo } = require('../src/services/stripe-coupon.service');
const { PLAN_TERMS } = require('../src/core/first-purchase-discount');
const { PLAN_TERMS: SNAPSHOT_PLAN_TERMS } = require('../src/infrastructure/repositories/onboarding-plan-snapshot.repository');

describe('StripeCouponService', () => {
  describe('stored term percents', () => {
    // US 6-month at 35, BR at the seeded 40.
    const termDiscounts = {
      percentsFor: jest.fn(async (account) => (account === 'us' ? { 1: 10, 3: 25, 6: 35 } : { 1: 10, 3: 25, 6: 40 }))
    };
    const repository = {
      getMapping: jest.fn().mockResolvedValue({ mapping: { 1: 'promo_1', 3: 'promo_3', 6: 'promo_6' }, coupons: {} }),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };

    test('Accounts are independent: each checkout gets the percent of its own account', async () => {
      const service = new StripeCouponService(repository, { termDiscounts });

      const us = await service.resolveFirstPurchasePromotionForCheckout({ eligible: true, termMonths: 6, account: 'us' });
      const br = await service.resolveFirstPurchasePromotionForCheckout({ eligible: true, termMonths: 6, account: 'br' });

      expect([us.discount_percent, br.discount_percent]).toEqual([35, 40]);
      expect(termDiscounts.percentsFor).toHaveBeenCalledWith('us');
      expect(termDiscounts.percentsFor).toHaveBeenCalledWith('br');
    });

    test('health lists the stored percents of the account', async () => {
      const service = new StripeCouponService(repository, { termDiscounts });
      expect((await service.mappingHealth('us')).terms).toEqual([
        { subscription_term_months: 1, discount_percent: 10 },
        { subscription_term_months: 3, discount_percent: 25 },
        { subscription_term_months: 6, discount_percent: 35 }
      ]);
    });

    test('the three terms are unchanged with the seed', async () => {
      const seeded = { percentsFor: jest.fn().mockResolvedValue({ 1: 10, 3: 25, 6: 40 }) };
      const service = new StripeCouponService(repository, { termDiscounts: seeded });
      const percents = [];
      for (const termMonths of [1, 3, 6]) {
        percents.push((await service.resolveFirstPurchasePromotionForCheckout({ eligible: true, termMonths, account: 'br' })).discount_percent);
      }
      expect(percents).toEqual([10, 25, 40]);
      expect((await service.mappingHealth('br')).terms).toEqual(PLAN_TERMS);
    });

    test('a promotion code without term metadata is matched by the stored percent', () => {
      const promo = { coupon: { percent_off: 35 }, metadata: {} };
      expect(termFromStripePromo(promo, { 1: 10, 3: 25, 6: 35 })).toBe(6);
      expect(termFromStripePromo(promo)).toBeNull();
      expect(termFromStripePromo({ coupon: { percent_off: 35 }, metadata: { pawbowl_term_months: '3' } }, { 1: 10, 3: 25, 6: 35 })).toBe(3);
    });
  });

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
      terms: PLAN_TERMS,
      misconfig_count: 0,
      stripe_account: 'us'
    });
  });

  test('health lists the three terms with the percents the plan snapshot offers', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({ mapping: { 1: 'promo_1', 3: 'promo_3', 6: 'promo_6' }, coupons: {} }),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const service = new StripeCouponService(repository);

    const health = await service.mappingHealth('br');

    expect(health.terms).toEqual([
      { subscription_term_months: 1, discount_percent: 10 },
      { subscription_term_months: 3, discount_percent: 25 },
      { subscription_term_months: 6, discount_percent: 40 }
    ]);
    expect(health.terms).toEqual(SNAPSHOT_PLAN_TERMS);
  });

  test('health without any mapped coupon still lists the terms', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue(null),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const service = new StripeCouponService(repository);

    const health = await service.mappingHealth('us');

    expect(health.missing_terms).toEqual([1, 3, 6]);
    expect(health.terms.map((term) => term.subscription_term_months)).toEqual([1, 3, 6]);
    health.terms[0].discount_percent = 99;
    expect(PLAN_TERMS[0].discount_percent).toBe(10);
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

    expect(repository.saveMapping).toHaveBeenCalledWith({ 3: 'promo_env_3m' }, {}, 'us');
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

    expect(repository.saveMapping).toHaveBeenCalledWith({ 1: 'promo_saved' }, {}, 'us');
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
          promotion: { type: 'coupon', coupon: { id: 'coupon_saved' } }
        })
      }
    };
    const service = new StripeCouponService(repository, {
      stripeBilling: { ensureClient: () => stripe }
    });

    await service.saveMapping({ 1: 'promo_saved' });

    expect(stripe.promotionCodes.retrieve).toHaveBeenCalledWith('promo_saved', { expand: ['promotion.coupon'] });
    expect(repository.saveMapping).toHaveBeenCalledWith({ 1: 'promo_saved' }, { 1: 'coupon_saved' }, 'us');
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
              promotion: { type: 'coupon', coupon: { id: 'coupon_3', percent_off: 25, duration: 'once' } },
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

    expect(stripe.promotionCodes.list).toHaveBeenCalledWith(expect.objectContaining({ expand: ['data.promotion.coupon'] }));
    expect(repository.saveMapping).toHaveBeenCalledWith(
      { 1: 'promo_stored_1m', 3: 'promo_stripe_3m' },
      { 1: 'coupon_1', 3: 'coupon_3' },
      'us'
    );
    expect(result.slots[1].source).toBe('stored');
    expect(result.slots[3].source).toBe('stripe');
    expect(result.missing_in_stripe).toEqual([]);
  });

  describe('percent mismatch in the synced slots', () => {
    function syncWith({ listed = [], retrieved = {}, mapping }) {
      const repository = {
        getMapping: jest.fn().mockResolvedValue({ mapping, coupons: { 1: null, 3: null, 6: null } }),
        saveMapping: jest.fn().mockResolvedValue(undefined),
        getMisconfigCount: jest.fn().mockResolvedValue(0)
      };
      const stripe = {
        promotionCodes: {
          list: jest.fn().mockResolvedValue({ data: listed }),
          retrieve: jest.fn(async (id) => {
            if (!retrieved[id]) throw new Error('No such promotion code');
            return retrieved[id];
          })
        }
      };
      return new StripeCouponService(repository, {
        stripeBilling: { ensureClient: () => stripe },
        termDiscounts: { percentsFor: jest.fn().mockResolvedValue({ 1: 10, 3: 25, 6: 40 }) }
      }).syncFirstPurchasePromos('br');
    }

    test('Coupon mapped by hand with another percent: the 1-month slot reports the mismatch and the coupon percent', async () => {
      const result = await syncWith({
        mapping: { 1: 'promo_hand_1m', 3: 'promo_3m', 6: 'promo_gone' },
        listed: [
          { id: 'promo_hand_1m', active: true, promotion: { coupon: { id: 'coupon_15', percent_off: 15, duration: 'once' } }, metadata: {} },
          { id: 'promo_3m', active: true, promotion: { coupon: { id: 'coupon_25', percent_off: 25, duration: 'once' } }, metadata: {} }
        ]
      });

      expect(result.slots[1]).toMatchObject({ promotion_code_id: 'promo_hand_1m', percent_off: 15, percent_mismatch: true });
      expect(result.slots[3]).toMatchObject({ percent_off: 25, percent_mismatch: false });
      // A mapped promotion code missing in Stripe has no coupon to compare.
      expect(result.slots[6]).toMatchObject({ percent_off: null, percent_mismatch: false });
      expect(result.missing_in_stripe).toEqual([6]);
    });

    test('a slot filled from a Stripe candidate is compared with the stored percent too', async () => {
      const result = await syncWith({
        mapping: { 1: null, 3: null, 6: null },
        listed: [{
          id: 'promo_new_6m', active: true, created: 1,
          promotion: { coupon: { id: 'coupon_35', percent_off: 35, duration: 'once' } },
          restrictions: { first_time_transaction: true },
          metadata: { pawbowl_purpose: 'first_purchase', pawbowl_term_months: '6' }
        }]
      });

      expect(result.slots[6]).toMatchObject({ source: 'stripe', percent_off: 35, percent_mismatch: true });
    });
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
            { id: 'promo_1m', code: 'FIRST_1M', active: true, promotion: { type: 'coupon', coupon: 'coupon_1' } }
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

  test('reads and writes first-purchase maps per Stripe account', async () => {
    const repository = {
      getMapping: jest.fn().mockResolvedValue({
        mapping: { 1: 'promo_br_1m', 3: null, 6: null },
        coupons: { 1: 'coupon_br', 3: null, 6: null }
      }),
      saveMapping: jest.fn().mockResolvedValue(undefined),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const service = new StripeCouponService(repository);

    await service.getMapping('br');
    await service.saveMapping({ 1: 'promo_br_1m' }, {}, 'br');

    expect(repository.getMapping).toHaveBeenCalledWith('br');
    expect(repository.saveMapping).toHaveBeenCalledWith({ 1: 'promo_br_1m' }, {}, 'br');
  });
});
