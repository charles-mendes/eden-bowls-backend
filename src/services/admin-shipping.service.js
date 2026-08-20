const {
  detectShippingEnvOverrides,
  loadShippingSettings,
  saveShippingSettings
} = require('../infrastructure/shipping/shipping-settings');

class AdminShippingService {
  constructor(options = {}) {
    this.shippingService = options.shippingService || null;
    this.filePath = options.filePath;
    this.env = options.env || process.env;
  }

  getSettings() {
    const settings = loadShippingSettings({ filePath: this.filePath, env: this.env });
    return {
      success: true,
      data: {
        settings,
        envOverrides: detectShippingEnvOverrides(this.env)
      }
    };
  }

  saveSettings(payload = {}) {
    const settings = saveShippingSettings(payload, { filePath: this.filePath, env: this.env });
    if (this.shippingService) {
      this.shippingService.settings = settings;
    }

    return {
      success: true,
      data: {
        settings,
        envOverrides: detectShippingEnvOverrides(this.env)
      }
    };
  }

  async test(payload = {}) {
    if (!this.shippingService) {
      const { HttpError } = require('../core/http-error');
      throw new HttpError(503, 'Shipping service is not available.');
    }

    return this.shippingService.calculate(payload);
  }
}

module.exports = {
  AdminShippingService
};
