const { HttpError } = require('../core/http-error');

function normalizePostalInput(payload = {}) {
  const rawInput = String(payload.zipcode || payload.postal_code || payload.postalCode || '').trim();
  const normalizedInput = rawInput.replace(/\s+/g, '');
  const digitsOnly = normalizedInput.replace(/\D/g, '');
  return { rawInput, normalizedInput, digitsOnly };
}

function inferCountry(payload = {}, normalizedInput = '', digitsOnly = '') {
  const explicitCountry = String(payload.country || '').trim().toUpperCase();
  if (explicitCountry === 'BR' || explicitCountry === 'US') {
    return explicitCountry;
  }

  if (/^\d{5}(-\d{4})?$/.test(normalizedInput) || /^\d{9}$/.test(normalizedInput)) {
    return 'US';
  }

  if (/^\d{8}$/.test(digitsOnly || String(normalizedInput || '').replace(/\D/g, ''))) {
    return 'BR';
  }

  return '';
}

function isPostalComplete(country, normalizedInput, digitsOnly = '') {
  if (country === 'US') {
    return /^\d{5}(-\d{4})?$/.test(normalizedInput) || /^\d{9}$/.test(normalizedInput);
  }

  if (country === 'BR') {
    return /^\d{8}$/.test(digitsOnly || String(normalizedInput || '').replace(/\D/g, ''));
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
    return /^\d{5}(-\d{4})?$/.test(normalizedInput) || /^\d{9}$/.test(normalizedInput) || /^\d{1,9}$/.test(normalizedInput.replace(/-/g, ''));
  }

  if (country === 'BR') {
    return /^\d+$/.test(normalizedInput.replace(/\D/g, '')) && normalizedInput.replace(/\D/g, '').length <= 8;
  }

  return false;
}

function emptyLookup(status, country, rawInput, zipcode, message) {
  return {
    success: true,
    data: {
      status,
      country,
      zipcode_input: rawInput,
      zipcode,
      is_complete: false,
      state: '',
      city: '',
      street: '',
      neighborhood: '',
      complement: '',
      message
    }
  };
}

class OnboardingZipcodeLookupService {
  constructor(repository) {
    this.repository = repository;
  }

  async lookup({ payload = {} }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding zipcode lookup repository is not available.');
    }

    const { rawInput, normalizedInput, digitsOnly } = normalizePostalInput(payload);
    const country = inferCountry(payload, normalizedInput, digitsOnly);
    const zipcode = country === 'BR' ? digitsOnly : normalizedInput;

    if (!normalizedInput) {
      return emptyLookup('incomplete', country, rawInput, zipcode, 'Postal code is required.');
    }

    if (!isPostalValid(country, normalizedInput)) {
      return emptyLookup('invalid', country, rawInput, zipcode, 'Postal code contains invalid characters.');
    }

    if (!isPostalComplete(country, normalizedInput, digitsOnly)) {
      return emptyLookup('incomplete', country, rawInput, zipcode, 'Postal code is incomplete.');
    }

    const data = await this.repository.lookup({ country, zipcode });
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
