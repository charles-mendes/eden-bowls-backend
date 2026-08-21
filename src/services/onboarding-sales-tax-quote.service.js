const { HttpError } = require('../core/http-error');

function resolveAddress(payload = {}) {
  const address = payload.address || {};
  const country = String(address.country || 'US').toUpperCase();
  const state = String(address.state || '').trim();
  const postalCode = String(address.postal_code || address.postcode || address.zipcode || address.postalCode || '').trim();
  return { country, state, postalCode };
}

class OnboardingSalesTaxQuoteService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.automaticTaxEnabled = Boolean(options.automaticTaxEnabled);
  }

  async quote({ userId, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding sales tax quote repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const address = resolveAddress(payload);
    const subtotal = await this.resolveSubtotal(userId);

    if (address.country !== 'US') {
      return this.zeroQuote({
        subtotal,
        taxJurisdiction: `${address.country || 'XX'}-ZERO`,
        country: address.country || 'XX'
      });
    }

    if (!address.state || !address.postalCode) {
      throw new HttpError(422, 'Sales tax quote is unavailable.', {
        code: 'sales_tax_unavailable',
        reason: 'missing_address'
      });
    }

    // Stripe Tax is applied at subscription create when STRIPE_US_AUTOMATIC_TAX is on.
    // When the flag is off, tax is not collected. Either way this route returns 0 so
    // checkout can proceed without Stripe invoice preview or price ids.
    return this.zeroQuote({
      subtotal,
      taxJurisdiction: `US-${address.state}`,
      country: 'US'
    });
  }

  async zeroQuote({ subtotal, taxJurisdiction, country }) {
    const data = await this.repository.quote({
      subtotal,
      productTax: 0,
      productTaxPercent: 0,
      taxJurisdiction,
      country
    });
    return { success: true, data };
  }

  async resolveSubtotal(userId) {
    if (!this.repository.getPlanSubtotal) {
      return 0;
    }

    const subtotal = Number(await this.repository.getPlanSubtotal(userId));
    return Number.isFinite(subtotal) ? subtotal : 0;
  }
}

module.exports = {
  OnboardingSalesTaxQuoteService,
  resolveAddress
};
