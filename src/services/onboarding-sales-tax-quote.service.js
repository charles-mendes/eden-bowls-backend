const { HttpError } = require('../core/http-error');

function resolveAddress(payload = {}) {
  const address = payload.address || {};
  const country = String(address.country || 'US').toUpperCase();
  const state = String(address.state || '').trim();
  const postalCode = String(address.postal_code || address.postcode || '').trim();
  return { country, state, postalCode };
}

function calculateProductTax({ country, state, postalCode, subtotal }) {
  if (country !== 'US') {
    return {
      subtotal,
      productTax: 0,
      productTaxPercent: 0,
      taxJurisdiction: `${country}-ZERO`,
      country
    };
  }

  if (!subtotal || subtotal <= 0) {
    throw new HttpError(422, 'Sales tax quote is unavailable.', { code: 'sales_tax_unavailable', reason: 'missing_subtotal' });
  }

  if (!state || !postalCode) {
    throw new HttpError(422, 'Sales tax quote is unavailable.', { code: 'sales_tax_unavailable', reason: 'missing_address' });
  }

  const percent = state === 'CA' ? 10 : 0;
  return {
    subtotal,
    productTax: Number((subtotal * percent / 100).toFixed(2)),
    productTaxPercent: percent,
    taxJurisdiction: `US-${state}`,
    country
  };
}

class OnboardingSalesTaxQuoteService {
  constructor(repository) {
    this.repository = repository;
  }

  async quote({ userId, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding sales tax quote repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const address = resolveAddress(payload);
    const taxQuote = calculateProductTax({
      country: address.country,
      state: address.state,
      postalCode: address.postalCode,
      subtotal: 20
    });

    const data = await this.repository.quote(taxQuote);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingSalesTaxQuoteService,
  calculateProductTax,
  resolveAddress
};
