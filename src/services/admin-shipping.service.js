const { HttpError } = require('../core/http-error');

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

  async getSettings() {
    this.ensureRepository();
    const settings = await this.repository.get();
    this.applyToShippingService(settings);

    return {
      success: true,
      data: { settings }
    };
  }

  async saveSettings(payload = {}) {
    this.ensureRepository();
    const settings = await this.repository.save(payload);
    this.applyToShippingService(settings);

    return {
      success: true,
      data: { settings }
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
