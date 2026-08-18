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
    this.previewRepository = options.previewRepository || null;
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
      const data = await this.repository.quote({
        subtotal,
        productTax: 0,
        productTaxPercent: 0,
        taxJurisdiction: `${address.country || 'XX'}-ZERO`,
        country: address.country || 'XX'
      });
      return { success: true, data };
    }

    if (!address.state || !address.postalCode) {
      throw new HttpError(422, 'Sales tax quote is unavailable.', {
        code: 'sales_tax_unavailable',
        reason: 'missing_address'
      });
    }

    if (this.automaticTaxEnabled) {
      const data = await this.repository.quote({
        subtotal,
        productTax: 0,
        productTaxPercent: 0,
        taxJurisdiction: `US-${address.state}`,
        country: 'US'
      });
      return { success: true, data };
    }

    if (!subtotal || subtotal <= 0) {
      throw new HttpError(422, 'Sales tax quote is unavailable.', {
        code: 'sales_tax_unavailable',
        reason: 'missing_subtotal'
      });
    }

    if (this.previewRepository && this.previewRepository.preview) {
      try {
        const preview = await this.previewRepository.preview({
          address: {
            country: 'US',
            state: address.state,
            postal_code: address.postalCode,
            line1: String((payload.address && (payload.address.line1 || payload.address.street)) || ''),
            city: String((payload.address && payload.address.city) || '')
          },
          priceIds: this.previewRepository.getFallbackPriceIds
            ? await this.previewRepository.getFallbackPriceIds(userId)
            : []
        });
        const tax = Number(preview && preview.tax);
        const previewSubtotal = Number(preview && preview.subtotal) || subtotal;
        const percent = previewSubtotal > 0 ? Number(((tax / previewSubtotal) * 100).toFixed(4)) : 0;
        const data = await this.repository.quote({
          subtotal: previewSubtotal,
          productTax: Number((tax || 0).toFixed(2)),
          productTaxPercent: percent,
          taxJurisdiction: `US-${address.state}`,
          country: 'US'
        });
        return { success: true, data };
      } catch (error) {
        if (error instanceof HttpError && error.details && error.details.code === 'invalid_price_id') {
          throw new HttpError(422, 'Sales tax quote is unavailable.', {
            code: 'sales_tax_unavailable',
            reason: 'missing_price_ids'
          });
        }
        throw error;
      }
    }

    throw new HttpError(422, 'Sales tax quote is unavailable.', {
      code: 'sales_tax_unavailable',
      reason: 'sales_tax_unavailable'
    });
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
