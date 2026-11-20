const { buildForPet } = require('../core/nutrition-recommendation');
const { publishedParametersFor } = require('../infrastructure/repositories/onboarding-recommendation.repository');
const { buildSimplifiedRecommendation } = require('../core/simplified-consumption');
const { planPackagingFor } = require('../infrastructure/repositories/onboarding-recommendation.repository');
const { petSubscriptions } = require('../core/subscription-pet-link');
const {
  constrainMarketQuery,
  assertRecordMarket,
  shouldEnforceMarketScope
} = require('../core/admin-market-scope');

function presentDiscount(reference) {
  if (!reference) {
    return { eligibilityReason: 'Não aplicável / inelegível' };
  }
  return {
    promotionCodeId: reference.stripe_promotion_code_id || null,
    percent: reference.discount_percent || null,
    duration: reference.discount_duration || null,
    amountPaid: reference.stripe_amount_paid || null,
    eligibilityReason: reference.discount_eligibility && reference.discount_eligibility.reason
      ? reference.discount_eligibility.reason
      : (reference.stripe_promotion_code_id ? null : 'Não aplicável / inelegível')
  };
}

function lineItemsOf(planSelection) {
  return planSelection && planSelection.catalog_pricing
    ? planSelection.catalog_pricing.line_items || []
    : [];
}

function createdTime(item) {
  const time = item.createdAt ? new Date(item.createdAt).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

// checkout-history: one entry per subscription, newest purchase first. A subscription created before
// the snapshot existed shows what its ledger row still holds, which may reflect later edits.
function presentCheckoutHistory(subscriptions) {
  return [...subscriptions]
    .sort((left, right) => (createdTime(right) - createdTime(left)) || (Number(right.id) - Number(left.id)))
    .map((item) => {
      const snapshot = item.checkoutSnapshot && typeof item.checkoutSnapshot === 'object' ? item.checkoutSnapshot : null;
      const planSelection = snapshot ? snapshot.plan_selection : item.planSelection;
      const reference = snapshot ? snapshot.checkout_reference : null;
      return {
        subscriptionId: String(item.id),
        stripeSubscriptionId: item.stripeSubscriptionId,
        status: item.status,
        planLabel: item.planLabel,
        createdAt: item.createdAt,
        completeness: snapshot ? 'complete' : 'partial',
        source: snapshot ? snapshot.source || 'checkout' : 'ledger',
        capturedAt: snapshot ? snapshot.captured_at || null : null,
        planSelection: planSelection || null,
        petsSnapshot: (snapshot ? snapshot.pets_snapshot : item.petsSnapshot) || null,
        address: (snapshot ? snapshot.address : item.address) || null,
        shipping: (snapshot ? snapshot.shipping : item.shipping) || null,
        recurrence: snapshot ? snapshot.recurrence || null : null,
        subscriptionTermMonths: snapshot && snapshot.subscription_term_months != null
          ? snapshot.subscription_term_months
          : item.subscriptionTermMonths,
        lineItems: lineItemsOf(planSelection),
        discount: reference ? presentDiscount(reference) : null,
        checkoutReference: reference
      };
    });
}

class AdminOnboardingService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.ledgerRepository = options.ledgerRepository;
    this.lifeStageService = options.lifeStageService || null;
    this.recipeEnergyService = options.recipeEnergyService || null;
    this.productsRepository = options.productsRepository || null;
    this.nutritionParameters = options.nutritionParameters || null;
  }

  // Line of each checkout pet (puppy, adult, senior), null when it cannot be resolved.
  async lifeStagesFor(pets, market) {
    if (!this.lifeStageService || pets.length === 0) {
      return pets.map(() => null);
    }
    const stages = await this.lifeStageService.resolveMany(pets, market);
    return pets.map((_pet, index) => (stages[index] ? stages[index].lifeStage : null));
  }

  // kcal/kg per checkout pet from the mean energyKg of its line, null to keep the engine default.
  async energiesFor(pets, market, lifeStages) {
    if (!this.recipeEnergyService || pets.length === 0) {
      return pets.map(() => null);
    }
    return Promise.all(pets.map((_pet, index) => this.recipeEnergyService.forLifeStage(market, lifeStages[index])));
  }

  async getByUserId(userId, actor = {}) {
    const checkout = await this.repository.getCheckout(userId);
    if (!checkout) {
      const { HttpError } = require('../core/http-error');
      throw new HttpError(404, 'Checkout not found.');
    }
    if (shouldEnforceMarketScope(actor)) {
      assertRecordMarket(actor, checkout.market);
    }

    const subscriptions = this.ledgerRepository
      ? await this.ledgerRepository.listByUserId(userId)
      : [];
    const scopedSubscriptions = shouldEnforceMarketScope(actor)
      ? subscriptions.filter((item) => constrainMarketQuery(actor, {}).stripeAccounts.includes(String(item.stripeAccount || '').toLowerCase()))
      : subscriptions;
    const marketCountry = checkout.address && checkout.address.country === 'BR' ? 'BR' : 'US';
    const lifeStages = await this.lifeStagesFor(checkout.pets, marketCountry);
    const energies = await this.energiesFor(checkout.pets, marketCountry, lifeStages);
    const parameterSet = await publishedParametersFor(this.nutritionParameters);
    const recommendations = checkout.pets.map((pet, index) => buildForPet({
      id: pet.id,
      name: pet.name,
      breed: pet.breed,
      age: pet.ageYears,
      age_years: pet.ageYears,
      age_months: pet.ageMonths,
      weight: pet.weightInput,
      weight_unit: pet.weightUnit,
      size: pet.size,
      activity_level: pet.activityLevel,
      pet_condition: pet.petCondition,
      neutered: pet.neutered,
      // The line picks the growth or senior factor of Tabela 1, as in the store.
      life_stage: lifeStages[index] || ''
    }, energies[index] ? { nem_kcal_kg: energies[index] } : null, '', parameterSet.parameters));
    const simplified = checkout.pets.length
      ? buildSimplifiedRecommendation(recommendations, { country: marketCountry }, await planPackagingFor(this.productsRepository, marketCountry))
      : null;

    return {
      userId: checkout.userId,
      email: checkout.email,
      displayName: checkout.displayName,
      activationStatus: checkout.activationStatus,
      createdAt: checkout.createdAt,
      updatedAt: checkout.updatedAt,
      empty: !checkout.checkoutReference,
      customer: {
        userId: checkout.userId,
        email: checkout.email,
        displayName: checkout.displayName,
        activationStatus: checkout.activationStatus
      },
      subscriptions: scopedSubscriptions.map((item) => ({
        id: String(item.id),
        stripeSubscriptionId: item.stripeSubscriptionId,
        status: item.status,
        currentPeriodEnd: item.currentPeriodEnd,
        cancelAtPeriodEnd: item.cancelAtPeriodEnd,
        planLabel: item.planLabel
      })),
      pets: checkout.pets.map((pet, index) => ({
        ...pet,
        simplified: simplified && simplified.pets ? simplified.pets[index] : null,
        // The subscriptions that still own the pet, newest first (admin-customer-subscriptions).
        subscriptions: petSubscriptions(pet.id, scopedSubscriptions).map((item) => ({
          id: String(item.id),
          stripeSubscriptionId: item.stripeSubscriptionId,
          status: item.status,
          planLabel: item.planLabel
        }))
      })),
      recurrence: checkout.recurrence,
      planSelection: checkout.planSelection,
      address: checkout.address,
      shipping: checkout.shipping,
      discount: presentDiscount(checkout.checkoutReference),
      lineItems: lineItemsOf(checkout.planSelection),
      checkoutReference: checkout.checkoutReference,
      paymentReference: checkout.paymentReference,
      checkouts: presentCheckoutHistory(scopedSubscriptions),
      simplified
    };
  }
}

module.exports = {
  AdminOnboardingService
};
