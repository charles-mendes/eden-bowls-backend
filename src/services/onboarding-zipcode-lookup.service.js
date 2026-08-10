const { HttpError } = require('../core/http-error');

function normalizePostalInput(payload = {}) {
  const rawInput = String(payload.zipcode || payload.postal_code || payload.postalCode || '').trim();
  const normalizedInput = rawInput.replace(/\s+/g, '');
  return { rawInput, normalizedInput };
}

function inferCountry(payload = {}, normalizedInput = '') {
  const explicitCountry = String(payload.country || '').trim().toUpperCase();
  if (explicitCountry === 'BR' || explicitCountry === 'US') {
    return explicitCountry;
  }

  if (/^\d{5}(-\d{4})?$/.test(normalizedInput)) {
    return 'US';
  }

  if (/^\d{8}$/.test(normalizedInput)) {
    return 'BR';
  }

  return '';
}

function isPostalComplete(country, normalizedInput) {
  if (country === 'US') {
    return /^\d{5}(-\d{4})?$/.test(normalizedInput) || /^\d{9}$/.test(normalizedInput);
  }

  if (country === 'BR') {
    return /^\d{8}$/.test(normalizedInput);
  }

  return false;
}

function isPostalValid(country, normalizedInput) {
  if (!normalizedInput) {
    return false;
  }

  const invalidCharacters = /[^0-9-\s]/.test(normalizedInput);
  if (invalidCharacters) {
    return false;
  }

  if (country === 'US') {
    return /^\d{5}(-\d{4})?$/.test(normalizedInput) || /^\d{9}$/.test(normalizedInput);
  }

  if (country === 'BR') {
    return /^\d{8}$/.test(normalizedInput);
  }

  return false;
}

class OnboardingZipcodeLookupService {
  constructor(repository) {
    this.repository = repository;
  }

  async lookup({ sessionId, payload = {}, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding zipcode lookup repository is not available.');
    }

    const { rawInput, normalizedInput } = normalizePostalInput(payload);
    const country = inferCountry(payload, normalizedInput);

    if (!normalizedInput) {
      return {
        success: true,
        data: {
          status: 'incomplete',
          country,
          zipcode_input: rawInput,
          zipcode: normalizedInput,
          is_complete: false,
          state: '',
          city: '',
          street: '',
          neighborhood: '',
          complement: '',
          message: 'Postal code is required.'
        }
      };
    }

    if (!isPostalValid(country, normalizedInput)) {
      return {
        success: true,
        data: {
          status: 'invalid',
          country,
          zipcode_input: rawInput,
          zipcode: normalizedInput,
          is_complete: false,
          state: '',
          city: '',
          street: '',
          neighborhood: '',
          complement: '',
          message: 'Postal code contains invalid characters.'
        }
      };
    }

    if (!isPostalComplete(country, normalizedInput)) {
      return {
        success: true,
        data: {
          status: 'incomplete',
          country,
          zipcode_input: rawInput,
          zipcode: normalizedInput,
          is_complete: false,
          state: '',
          city: '',
          street: '',
          neighborhood: '',
          complement: '',
          message: 'Postal code is incomplete.'
        }
      };
    }

    const data = await this.repository.lookup(sessionId, { country, zipcode: normalizedInput }, { currentUser, sessionToken });
    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingZipcodeLookupService,
  normalizePostalInput,
  inferCountry,
  isPostalComplete,
  isPostalValid
};
