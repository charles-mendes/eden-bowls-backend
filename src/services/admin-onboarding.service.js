const { buildForPet } = require('../core/nutrition-recommendation');
const { buildSimplifiedRecommendation } = require('../core/simplified-consumption');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');

function toCsv(items) {
  const header = [
    'userId',
    'email',
    'displayName',
    'updatedAt',
    'stripeStatus',
    'stripeSubscriptionId',
    'frequency',
    'termMonths',
    'firstInvoiceTotal'
  ];
  const lines = [header.join(',')];

  for (const item of items) {
    lines.push(header.map((key) => {
      const value = item[key] == null ? '' : String(item[key]).replace(/"/g, '""');
      return `"${value}"`;
    }).join(','));
  }

  return `${lines.join('\n')}\n`;
}

class AdminOnboardingService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.ledgerRepository = options.ledgerRepository;
  }

  async list(query, pagination) {
    const result = await this.repository.listCheckouts(query, pagination);
    return paginatedEnvelope({
      items: result.items,
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  async metrics(query) {
    return this.repository.metrics(query);
  }

  async csv(query) {
    const result = await this.repository.listCheckouts(query, { offset: 0, perPage: 10000 });
    return toCsv(result.items);
  }

  async getByUserId(userId) {
    const checkout = await this.repository.getCheckout(userId);
    if (!checkout) {
      const { HttpError } = require('../core/http-error');
      throw new HttpError(404, 'Checkout not found.');
    }

    const subscriptions = this.ledgerRepository
      ? await this.ledgerRepository.listByUserId(userId)
      : [];
    const recommendations = checkout.pets.map((pet) => buildForPet({
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
      neutered: pet.neutered
    }));
    const marketCountry = checkout.address && checkout.address.country === 'BR' ? 'BR' : 'US';
    const simplified = checkout.pets.length
      ? buildSimplifiedRecommendation(recommendations, { country: marketCountry })
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
      subscriptions: subscriptions.map((item) => ({
        id: String(item.id),
        stripeSubscriptionId: item.stripeSubscriptionId,
        status: item.status,
        currentPeriodEnd: item.currentPeriodEnd,
        cancelAtPeriodEnd: item.cancelAtPeriodEnd,
        planLabel: item.planLabel
      })),
      pets: checkout.pets.map((pet, index) => ({
        ...pet,
        simplified: simplified && simplified.pets ? simplified.pets[index] : null
      })),
      recurrence: checkout.recurrence,
      planSelection: checkout.planSelection,
      address: checkout.address,
      shipping: checkout.shipping,
      discount: checkout.checkoutReference ? {
        promotionCodeId: checkout.checkoutReference.stripe_promotion_code_id || null,
        percent: checkout.checkoutReference.discount_percent || null,
        duration: checkout.checkoutReference.discount_duration || null,
        amountPaid: checkout.checkoutReference.stripe_amount_paid || null,
        eligibilityReason: checkout.checkoutReference.discount_eligibility
          && checkout.checkoutReference.discount_eligibility.reason
          ? checkout.checkoutReference.discount_eligibility.reason
          : (checkout.checkoutReference.stripe_promotion_code_id ? null : 'Não aplicável / inelegível')
      } : { eligibilityReason: 'Não aplicável / inelegível' },
      lineItems: checkout.planSelection && checkout.planSelection.catalog_pricing
        ? checkout.planSelection.catalog_pricing.line_items || []
        : [],
      checkoutReference: checkout.checkoutReference,
      paymentReference: checkout.paymentReference,
      simplified
    };
  }
}

module.exports = {
  AdminOnboardingService
};
