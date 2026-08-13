const { HttpError } = require('../core/http-error');

const RECURRENCE_ALIAS_MAP = {
  weekly: 'weekly',
  semanal: 'weekly',
  '6 month': 'weekly',
  '6 months': 'weekly',
  biweekly: 'biweekly',
  fortnightly: 'biweekly',
  quinzenal: 'biweekly',
  '3 month': 'biweekly',
  '3 months': 'biweekly',
  monthly: 'monthly',
  mensal: 'monthly',
  '1 month': 'monthly',
  '1 months': 'monthly'
};

function normalizeRecurrenceFrequency(value) {
  if (typeof value !== 'string') {
    throw new HttpError(422, 'Frequency must be weekly, biweekly, monthly, 1 month, 3 months, or 6 months.', { code: 'invalid_recurrence_frequency' });
  }

  const normalized = RECURRENCE_ALIAS_MAP[value.trim().toLowerCase()];
  if (!normalized) {
    throw new HttpError(422, 'Frequency must be weekly, biweekly, monthly, 1 month, 3 months, or 6 months.', { code: 'invalid_recurrence_frequency' });
  }

  return normalized;
}

function resolvePeriodDays(frequency) {
  switch (frequency) {
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
    case 'monthly':
    default:
      return 30;
  }
}

class OnboardingRecurrenceService {
  constructor(repository) {
    this.repository = repository;
  }

  async setRecurrence({ userId, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding recurrence repository is not available.');
    }

    const frequency = normalizeRecurrenceFrequency(payload && payload.frequency);
    const periodDays = resolvePeriodDays(frequency);

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.setRecurrence(userId, { frequency, periodDays });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingRecurrenceService,
  normalizeRecurrenceFrequency,
  resolvePeriodDays
};
