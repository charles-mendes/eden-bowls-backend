const { buildForPet } = require('../core/nutrition-recommendation');
const { buildSimplifiedRecommendation } = require('../core/simplified-consumption');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');

const STRIPE_STATUS_LABELS = {
  mixed: 'Misto',
  unlinked: 'Não vinculado',
  active: 'Ativo',
  trialing: 'Em trial',
  past_due: 'Pagamento atrasado',
  canceled: 'Cancelado',
  cancelled: 'Cancelado',
  unpaid: 'Não pago',
  incomplete: 'Incompleto',
  incomplete_expired: 'Expirado',
  paused: 'Pausado'
};

const FREQUENCY_LABELS = {
  monthly: 'Mensal',
  month: 'Mensal',
  every_month: 'Mensal',
  weekly: 'Semanal',
  week: 'Semanal',
  every_week: 'Semanal',
  biweekly: 'Quinzenal',
  bi_weekly: 'Quinzenal',
  fortnightly: 'Quinzenal',
  every_4_weeks: 'A cada 4 semanas'
};

function resolveTimeZone(value) {
  const timeZone = String(value || '').trim();
  if (!timeZone) {
    return 'UTC';
  }

  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch (_error) {
    return 'UTC';
  }
}

function formatCsvDate(value, timeZone) {
  if (value == null || value === '') {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
    timeZone
  }).format(date);
}

function formatCsvStripeStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  return STRIPE_STATUS_LABELS[raw.toLowerCase()] || raw;
}

function formatCsvFrequency(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (FREQUENCY_LABELS[normalized]) {
    return FREQUENCY_LABELS[normalized];
  }

  const everyNMonths = /^(?:every_)?(\d+)_months?$/.exec(normalized);
  if (everyNMonths) {
    const count = everyNMonths[1];
    return count === '1' ? 'Mensal' : `A cada ${count} meses`;
  }

  return raw;
}

function toCsv(items, timeZone) {
  const resolvedTimeZone = resolveTimeZone(timeZone);
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
    const row = {
      ...item,
      updatedAt: formatCsvDate(item.updatedAt, resolvedTimeZone),
      stripeStatus: formatCsvStripeStatus(item.stripeStatus),
      frequency: formatCsvFrequency(item.frequency)
    };

    lines.push(header.map((key) => {
      const value = row[key] == null ? '' : String(row[key]).replace(/"/g, '""');
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

  async csv(query = {}) {
    const timezone = query.timezone;
    const filters = { ...query };
    delete filters.timezone;
    const result = await this.repository.listCheckouts(filters, { offset: 0, perPage: 10000 });
    return toCsv(result.items, timezone);
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
