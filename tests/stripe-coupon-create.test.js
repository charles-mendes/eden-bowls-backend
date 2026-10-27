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
    const [promotionPayload] = stripe.promotionCodes.create.mock.calls[0];
    expect(promotionPayload).toMatchObject({
      promotion: { type: 'coupon', coupon: 'coupon_1' },
      code: 'FIRST_1M',
      restrictions: { first_time_transaction: true }
    });
    // API 2025-09-30.clover rejects a top-level coupon: "Received unknown parameter: coupon".
    expect(promotionPayload).not.toHaveProperty('coupon');
    expect(repository.saveMapping).toHaveBeenCalled();
    expect(result.data.promotion_code_id).toBe('promo_created');
  });
});

describe('StripeCouponService createFirstPurchaseCoupon with a new percent', () => {
  const actor = { userId: '7', email: 'ops@edenbowls.com' };

  // BR mapping with the seeded percents, a Stripe client and a transaction that records what it wrote.
  function setup({ couponError = null } = {}) {
    const state = { mapping: { 1: 'promo_br_1', 3: 'promo_br_3', 6: 'promo_br_6' }, coupons: { 1: 'c1', 3: 'c3', 6: 'c6' }, percents: { 1: 10, 3: 25, 6: 40 } };
    const repository = {
      getMapping: jest.fn(async () => ({ mapping: { ...state.mapping }, coupons: { ...state.coupons } })),
      saveMapping: jest.fn(async (mapping, coupons) => {
        Object.assign(state.mapping, mapping);
        Object.assign(state.coupons, coupons);
      }),
      getMisconfigCount: jest.fn().mockResolvedValue(0)
    };
    const termDiscounts = {
      percentsFor: jest.fn(async () => ({ ...state.percents })),
      savePercent: jest.fn(async ({ termMonths, percent }, manager) => {
        expect(manager).toBe(transactionManager);
        state.percents[termMonths] = percent;
      })
    };
    const transactionManager = { query: jest.fn() };
    const dataSource = { transaction: jest.fn(async (work) => work(transactionManager)) };
    const auditRepository = { createIn: jest.fn().mockResolvedValue(1) };
    const stripe = {
      coupons: {
        create: couponError ? jest.fn().mockRejectedValue(couponError) : jest.fn().mockResolvedValue({ id: 'coupon_br_3_30' })
      },
      promotionCodes: { create: jest.fn().mockResolvedValue({ id: 'promo_br_3_30', code: 'PRIMEIRA3M30' }) }
    };
    const service = new StripeCouponService(repository, {
      stripeBilling: { ensureClient: () => stripe },
      termDiscounts,
      auditRepository,
      dataSource
    });
    return { service, state, repository, termDiscounts, auditRepository, dataSource, stripe, transactionManager };
  }

  test('Raise the 3-month percent in BR: new coupon mapped, percent stored and audited, previous coupon kept', async () => {
    const { service, state, stripe, auditRepository, transactionManager, repository } = setup();

    const result = await service.createFirstPurchaseCoupon({ account: 'br', term_months: 3, code: 'PRIMEIRA3M30', percent_off: 30 }, actor);

    expect(stripe.coupons.create).toHaveBeenCalledWith(expect.objectContaining({ percent_off: 30, duration: 'once' }));
    expect(state.mapping[3]).toBe('promo_br_3_30');
    expect(state.percents).toEqual({ 1: 10, 3: 30, 6: 40 });
    expect(auditRepository.createIn).toHaveBeenCalledWith(transactionManager, {
      actorUserId: 7,
      actorEmail: 'ops@edenbowls.com',
      action: 'billing.first_purchase.percent.update',
      metadata: { stripe_account: 'br', term_months: 3, from: 25, to: 30 }
    });
    expect(result.data).toMatchObject({ percent_off: 30, promotion_code_id: 'promo_br_3_30' });
    expect(result.data.health.terms[1]).toEqual({ subscription_term_months: 3, discount_percent: 30 });
    // Stripe keeps the previous coupon: nothing deletes or deactivates it.
    expect(stripe.coupons.del).toBeUndefined();
    // Mapping before percent.
    expect(repository.saveMapping.mock.invocationCallOrder[0]).toBeLessThan(auditRepository.createIn.mock.invocationCallOrder[0]);

    const checkout = await service.resolveFirstPurchasePromotionForCheckout({ eligible: true, termMonths: 3, account: 'br' });
    expect(checkout).toMatchObject({ promotion_code_id: 'promo_br_3_30', discount_percent: 30 });
  });

  test('Stripe refuses the coupon: mapping and percent unchanged and the Stripe error returned', async () => {
    const stripeError = Object.assign(new Error('Invalid percent_off'), { type: 'StripeInvalidRequestError' });
    const { service, state, repository, termDiscounts, auditRepository } = setup({ couponError: stripeError });

    await expect(service.createFirstPurchaseCoupon({ account: 'br', term_months: 3, code: 'X', percent_off: 30 }, actor)).rejects.toBe(stripeError);

    expect(repository.saveMapping).not.toHaveBeenCalled();
    expect(termDiscounts.savePercent).not.toHaveBeenCalled();
    expect(auditRepository.createIn).not.toHaveBeenCalled();
    expect(state.mapping[3]).toBe('promo_br_3');
    expect(state.percents[3]).toBe(25);
  });

  test.each([95, 0, 12.5, 'abc'])('Percent out of range: %j is refused with 422 and nothing reaches Stripe', async (percentOff) => {
    const { service, stripe } = setup();

    await expect(service.createFirstPurchaseCoupon({ account: 'br', term_months: 3, code: 'X', percent_off: percentOff }, actor))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'invalid_percent_off' } });
    expect(stripe.coupons.create).not.toHaveBeenCalled();
  });

  test('without percent_off the stored percent of the term is used and nothing is rewritten', async () => {
    const { service, stripe, termDiscounts, auditRepository } = setup();

    await service.createFirstPurchaseCoupon({ account: 'br', term_months: 6, code: 'PRIMEIRA6M' }, actor);

    expect(stripe.coupons.create).toHaveBeenCalledWith(expect.objectContaining({ percent_off: 40 }));
    expect(termDiscounts.savePercent).not.toHaveBeenCalled();
    expect(auditRepository.createIn).not.toHaveBeenCalled();
  });

  test('an unmapped coupon does not change the stored percent', async () => {
    const { service, state, termDiscounts } = setup();

    await service.createFirstPurchaseCoupon({ account: 'br', term_months: 3, code: 'TESTE', percent_off: 30, assign_first_purchase_slot: false }, actor);

    expect(termDiscounts.savePercent).not.toHaveBeenCalled();
    expect(state.mapping[3]).toBe('promo_br_3');
  });
});
