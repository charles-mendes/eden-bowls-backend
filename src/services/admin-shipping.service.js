const { HttpError } = require('../core/http-error');
const { constrainMarketQuery, shouldEnforceMarketScope } = require('../core/admin-market-scope');

class AdminShippingService {
  constructor(options = {}) {
    this.shippingService = options.shippingService || null;
    this.repository = options.repository || null;
  }

  ensureRepository() {
    if (!this.repository) {
      throw new HttpError(503, 'Shipping settings repository is not available.');
    }
  }

  applyToShippingService(settings) {
    if (this.shippingService) {
      this.shippingService.settings = settings;
    }
  }

  scopedSettings(settings, actor) {
    if (!shouldEnforceMarketScope(actor)) {
      return settings;
    }
    const scoped = constrainMarketQuery(actor, {});
    if (scoped.markets.includes('BR') && scoped.markets.includes('US')) {
      return settings;
    }
    const filtered = {};
    if (scoped.markets.includes('BR') && settings && settings.br) {
      filtered.br = settings.br;
    }
    if (scoped.markets.includes('US') && settings && settings.us) {
      filtered.us = settings.us;
    }
    return filtered;
  }

  scopedPayload(payload, actor) {
    if (!shouldEnforceMarketScope(actor)) {
      return payload;
    }
    const scoped = constrainMarketQuery(actor, {});
    const next = { ...payload };
    if (!scoped.markets.includes('BR')) {
      delete next.br;
    }
    if (!scoped.markets.includes('US')) {
      delete next.us;
    }
    return next;
  }

  async getSettings(actor = {}) {
    this.ensureRepository();
    const settings = await this.repository.get();
    this.applyToShippingService(settings);

    return {
      success: true,
      data: { settings: this.scopedSettings(settings, actor) }
    };
  }

  async saveSettings(payload = {}, actor = {}) {
    this.ensureRepository();
    const settings = await this.repository.save(this.scopedPayload(payload, actor));
    this.applyToShippingService(settings);

    return {
      success: true,
      data: { settings: this.scopedSettings(settings, actor) }
    };
  }

  async test(payload = {}) {
    if (!this.shippingService) {
      throw new HttpError(503, 'Shipping service is not available.');
    }

    await this.getSettings();
    return this.shippingService.calculate(payload);
  }
}

module.exports = {
  AdminShippingService
};
