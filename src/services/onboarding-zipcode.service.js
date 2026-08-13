const { HttpError } = require('../core/http-error');

function normalizeCountry(country) {
  const value = String(country || '').trim().toUpperCase();
  if (value === 'BR' || value === 'US') {
    return value;
  }
  return '';
}

function normalizeZipcode(country, zipcode) {
  const value = String(zipcode || '').trim();
  if (!value) {
    return '';
  }

  const digitsOnly = value.replace(/\D/g, '');
  if (country === 'BR') {
    return digitsOnly.slice(0, 8);
  }

  if (country === 'US') {
    return value.replace(/[^0-9-]/g, '');
  }

  return value;
}

function normalizePhoneCountry(phoneCountry) {
  const value = String(phoneCountry || '').trim().toUpperCase();
  return value === 'BR' || value === 'US' ? value : '';
}

class OnboardingZipcodeService {
  constructor(repository) {
    this.repository = repository;
  }

  async setZipcode({ userId, payload = {} }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding zipcode repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const country = normalizeCountry(payload.country);
    const zipcode = normalizeZipcode(country, payload.zipcode || payload.postal_code || payload.postalCode);
    const state = String(payload.state || '').trim();
    const city = String(payload.city || '').trim();

    if (!country) {
      throw new HttpError(422, 'Country is required.', { code: 'invalid_country' });
    }

    if (!zipcode) {
      throw new HttpError(422, 'Zipcode is required.', { code: 'invalid_zipcode' });
    }

    if (country === 'BR' && !/^\d{8}$/.test(zipcode)) {
      throw new HttpError(422, 'Invalid Brazilian zipcode.', { code: 'invalid_zipcode' });
    }

    if (country === 'US' && !/^(\d{5})(-\d{4})?$/.test(zipcode)) {
      throw new HttpError(422, 'Invalid US zipcode.', { code: 'invalid_zipcode' });
    }

    if (!state || !city) {
      throw new HttpError(422, 'State and city are required.', { code: 'invalid_location' });
    }

    const normalizedPayload = {
      zipcode,
      postal_code: zipcode,
      country,
      state,
      city,
      street: String(payload.street || payload.address_line1 || '').trim(),
      number: String(payload.number || '').trim(),
      neighborhood: String(payload.neighborhood || '').trim(),
      complement: String(payload.complement || payload.address_line2 || '').trim(),
      phone: String(payload.phone || '').trim(),
      phone_country: normalizePhoneCountry(payload.phone_country || payload.phoneCountry),
      delivery_instructions: String(payload.delivery_instructions || payload.deliveryInstructions || '').trim(),
      address_line1: String(payload.street || payload.address_line1 || '').trim(),
      address_line2: String(payload.complement || payload.address_line2 || '').trim()
    };

    const data = await this.repository.saveZipcode(userId, normalizedPayload);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingZipcodeService,
  normalizeCountry,
  normalizeZipcode,
  normalizePhoneCountry
};
