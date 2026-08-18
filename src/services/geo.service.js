const {
  detectDomainFromRequest,
  detectRequestIp,
  normalizeGeoCountry
} = require('../core/geo-detection');

class GeoService {
  constructor(options = {}) {
    this.countryReader = options.countryReader || null;
    this.detectDomainFromRequest = options.detectDomainFromRequest || detectDomainFromRequest;
    this.detectRequestIp = options.detectRequestIp || ((request) => detectRequestIp(request, {
      trustProxy: Boolean(options.trustProxy)
    }));
    this.normalizeCountry = options.normalizeCountry || normalizeGeoCountry;
  }

  async getContext(request = {}) {
    const domain = this.detectDomainFromRequest(request);
    const ip = this.detectRequestIp(request);
    let country = 'UNKNOWN';

    if (ip && this.countryReader && typeof this.countryReader.lookupIsoCode === 'function') {
      try {
        country = this.normalizeCountry(await this.countryReader.lookupIsoCode(ip));
      } catch {
        country = 'UNKNOWN';
      }
    }

    return {
      success: true,
      data: {
        domain,
        country,
        ip: ip || '',
        region: null,
        source: 'backend',
        presetId: null
      }
    };
  }
}

module.exports = {
  GeoService
};
