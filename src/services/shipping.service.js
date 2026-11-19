const { customerShipping } = require('../core/customer-shipping');
const { HttpError } = require('../core/http-error');
const {
  applyShippingFee,
  billableDistanceKm,
  formatBrZipcode,
  haversineMeters
} = require('../core/shipping-fee');
const { currentBrDeliveryDays, setBrDeliveryDays, setBrDeliveryRadiusKm, setUsMaxTransitDays } = require('../core/delivery-closed-days');
const { loadShippingSettings } = require('../infrastructure/shipping/shipping-settings');
const { serviceLabel, setSkipDryIceInTest } = require('../infrastructure/shipping/ups-client');

function usStateCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

const US_READINESS_TTL_MS = 5 * 60 * 1000;

class ShippingService {
  constructor(options = {}) {
    this.settings = options.settings || loadShippingSettings();
    this.viaCepClient = options.viaCepClient || null;
    this.nominatimClient = options.nominatimClient || null;
    this.osrmClient = options.osrmClient || null;
    this.upsClient = options.upsClient || null;
    this.quoteSigner = options.quoteSigner || null;
    this.logger = options.logger || { warn() {} };
    this.production = Boolean(options.production);
    this.fixedTransitDays = Number.isFinite(Number(options.fixedTransitDays)) && Number(options.fixedTransitDays) > 0
      ? Number(options.fixedTransitDays)
      : 1;
  }

  get settings() {
    return this.currentSettings;
  }

  // The checkout area guard reads the same Brazil radius and US transit limit the quote enforces.
  set settings(value) {
    this.currentSettings = value;
    setBrDeliveryRadiusKm(value && value.br && value.br.rule ? value.br.rule.max_distance_km : null);
    // Every Brazil delivery date (checkout, emails, queue, the customer's deliveries) counts this many business days.
    setBrDeliveryDays(value && value.br && value.br.rule ? value.br.rule.delivery_days : null);
    setUsMaxTransitDays(value && value.us ? value.us.max_transit_days : null);
    // Every UPS request (quotes, the admin simulation, labels) reads the CIE dry ice switch from here.
    setSkipDryIceInTest(Boolean(value && value.us && value.us.skip_dry_ice_in_test));
    // Saved settings may fix (or break) the US quote, so the checkout readiness probe asks UPS again.
    this.usReadinessProbe = null;
  }

  // Whether a United States checkout would get a UPS quote with transit days (admin checkout readiness). `code` names
  // the first reason it would not; `unverified` means UPS could not be reached now. The live probe rates the ship-from
  // address to itself and is reused for US_READINESS_TTL_MS. Never returns credentials.
  async usCheckoutReadiness() {
    const us = (this.settings && this.settings.us) || {};
    const upsConfigured = Boolean(this.upsClient && this.upsClient.isConfigured());
    const result = (code, unverified = false) => ({ ups_configured: upsConfigured, code, unverified });

    if ((us.quote_mode || 'fixed') !== 'ups') {
      return result('us_shipping_fixed');
    }
    if (!upsConfigured) {
      return result('us_ups_not_configured');
    }
    const shipFrom = us.ship_from || {};
    if (!String(shipFrom.zipcode || '').replace(/\D/g, '')) {
      return result('us_ship_from_missing');
    }

    const now = Date.now();
    if (this.usReadinessProbe && now - this.usReadinessProbe.at < US_READINESS_TTL_MS) {
      return result(this.usReadinessProbe.code);
    }

    let code = null;
    try {
      const rated = await this.upsClient.rate({
        shipFrom,
        shipTo: { ...shipFrom, name: 'Checkout readiness', country: 'US' },
        package: us.package,
        allowedServiceCodes: us.allowed_service_codes,
        withTransit: true
      });
      if (!rated || !(Number(rated.deliveryDays) > 0)) {
        code = 'us_ups_quote_fallback';
      }
    } catch (error) {
      const unreachable = Boolean(
        error?.upsTimeout
        || error?.upsNetwork
        || error?.details?.code === 'ups_timeout'
        || error?.details?.code === 'ups_network_error'
      );
      if (unreachable) {
        return result(null, true);
      }
      code = 'us_ups_quote_fallback';
    }
    this.usReadinessProbe = { at: now, code };
    return result(code);
  }

  reportQuoteModeAtStartup(logger) {
    if (this.production && (this.settings.us.quote_mode || 'fixed') !== 'ups' && logger) {
      logger.error('US shipping quote_mode is fixed in production; United States checkout will refuse every address as unverified.');
    }
  }

  // Every quote carries what the customer pays (customer-shipping-charge): `shipping` stays the signed quote, and
  // original_amount / charged_amount / charge_enabled say whether it is charged. The store shows only these fields.
  withCustomerShipping(country, data) {
    const us = this.settings && this.settings.us;
    const charge = customerShipping({
      market: country,
      quote: data.shipping,
      chargeEnabled: Boolean(us && us.charge_shipping)
    });
    data.original_amount = charge.original_amount;
    data.charged_amount = charge.charged_amount;
    data.charge_enabled = charge.charge_enabled;
  }

  withQuoteToken(country, zipcode, result) {
    if (result && result.data) {
      this.withCustomerShipping(country, result.data);
    }
    if (!this.quoteSigner || !result || !result.data) {
      return result;
    }
    const data = result.data;
    data.quote_token = this.quoteSigner.sign({
      country,
      zipcode,
      cost: data.shipping,
      distance: country === 'BR' ? data.distance : null,
      deliveryDays: data.delivery_days
    });
    return result;
  }

  getPublicSettings(country) {
    const normalized = String(country || '').trim().toUpperCase();

    if (normalized === 'US') {
      const us = this.settings.us;
      return {
        success: true,
        data: {
          country: 'US',
          enabled: Boolean(us.enabled),
          cost: Number(Number(us.cost).toFixed(2)),
          label: us.label,
          carrier: us.carrier,
          delivery: us.delivery,
          currency: 'USD',
          quote_mode: us.quote_mode || 'fixed',
          fallback_enabled: Boolean(us.fallback_enabled),
          allowed_service_codes: Array.isArray(us.allowed_service_codes) ? us.allowed_service_codes : ['03']
        }
      };
    }

    const br = this.settings.br;
    return {
      success: true,
      data: {
        country: 'BR',
        enabled: Boolean(br.enabled),
        label: br.label,
        per_km: Number(br.rule.per_km),
        currency: 'BRL'
      }
    };
  }

  buildUsFallbackQuote(zipcode, reason = 'fallback') {
    const us = this.settings.us;
    return this.withQuoteToken('US', zipcode, {
      success: true,
      data: {
        shipping: Number(Number(us.cost).toFixed(2)),
        delivery_days: reason === 'fixed' && !this.production ? this.fixedTransitDays : null,
        currency: 'USD',
        label: us.label,
        carrier: us.carrier,
        delivery: us.delivery,
        service_code: null,
        rate_id: 'fixed_us:default',
        method_id: 'fixed_us',
        quoted_at: new Date().toISOString(),
        source: reason,
        destination: {
          zipcode: String(zipcode || '')
        }
      }
    });
  }

  // The fallback carries no transit days, so checkout refuses it: say why UPS was skipped.
  logUsFallback(reason, error) {
    this.logger.warn({
      reason,
      code: error?.details?.code || null,
      status: error?.statusCode || error?.status || null,
      message: error?.message || null
    }, 'US shipping quote fell back to the fixed rate; checkout will refuse it as delivery_area_unverified');
  }

  async calculateUs(payload = {}) {
    const us = this.settings.us;
    if (!us.enabled) {
      throw new HttpError(422, 'US shipping is disabled.', { code: 'shipping_disabled' });
    }

    const zipcode = String(payload.zipCode || payload.zipcode || '').replace(/\D/g, '').slice(0, 10);
    if (zipcode.length < 5) {
      throw new HttpError(400, 'Invalid US postal code.', { code: 'invalid_zipcode' });
    }

    if ((us.quote_mode || 'fixed') !== 'ups') {
      return this.buildUsFallbackQuote(zipcode, 'fixed');
    }

    if (!this.upsClient || !this.upsClient.isConfigured()) {
      if (us.fallback_enabled) {
        this.logUsFallback('ups_not_configured');
        return this.buildUsFallbackQuote(zipcode, 'fallback');
      }
      throw new HttpError(503, 'UPS is not configured.', { code: 'ups_not_configured' });
    }

    const shipFrom = us.ship_from || {};
    if (!String(shipFrom.zipcode || '').replace(/\D/g, '')) {
      if (us.fallback_enabled) {
        this.logUsFallback('ship_from_missing');
        return this.buildUsFallbackQuote(zipcode, 'fallback');
      }
      throw new HttpError(422, 'US ship-from postal code is not configured.', { code: 'ship_from_missing' });
    }

    try {
      const rated = await this.upsClient.rate({
        shipFrom,
        // Only what the customer gave: UPS refuses a ZIP outside the state it is sent with, and rates a bare ZIP.
        shipTo: {
          name: 'Customer',
          street: String(payload.street || '').trim(),
          city: String(payload.city || '').trim(),
          state: usStateCode(payload.state),
          zipcode,
          country: 'US'
        },
        package: us.package,
        allowedServiceCodes: us.allowed_service_codes,
        // Checkout refuses a US quote without transit days, and only Shoptimeintransit returns them for Ground.
        withTransit: true
      });

      const code = rated.serviceCode;
      return this.withQuoteToken('US', zipcode, {
        success: true,
        data: {
          shipping: Number(Number(rated.monetaryValue).toFixed(2)),
          delivery_days: rated.deliveryDays,
          currency: rated.currency || 'USD',
          label: rated.label || serviceLabel(code),
          carrier: 'UPS',
          delivery: rated.deliveryDays ? `${rated.deliveryDays} business days` : us.delivery,
          service_code: code,
          rate_id: `ups:${code}`,
          method_id: code === '03' ? 'ups_ground' : `ups_${code}`,
          quoted_at: new Date().toISOString(),
          source: 'ups',
          destination: {
            zipcode
          }
        }
      });
    } catch (error) {
      const retryable = Boolean(
        error?.upsTimeout
        || error?.upsNetwork
        || error?.details?.code === 'ups_timeout'
        || error?.details?.code === 'ups_network_error'
        || error?.details?.code === 'ups_upstream_error'
        || error?.details?.code === 'ups_oauth_failed'
        || error?.details?.code === 'ups_not_configured'
      );
      if (us.fallback_enabled && (retryable || error?.details?.code === 'ups_no_rates')) {
        this.logUsFallback('ups_rate_failed', error);
        return this.buildUsFallbackQuote(zipcode, 'fallback');
      }
      throw error;
    }
  }

  async calculate(payload = {}) {
    const country = String(payload.country || 'BR').trim().toUpperCase();
    if (country === 'US') {
      return this.calculateUs(payload);
    }
    if (country !== 'BR') {
      throw new HttpError(400, 'Distance shipping is only available for Brazil.', { code: 'country_not_supported' });
    }

    const br = this.settings.br;
    if (!br.enabled) {
      throw new HttpError(422, 'Brazil distance shipping is disabled.', { code: 'shipping_disabled' });
    }

    const zipcode = String(payload.zipCode || payload.zipcode || '').replace(/\D/g, '').slice(0, 8);
    if (zipcode.length !== 8) {
      throw new HttpError(400, 'Invalid Brazilian postal code.', { code: 'invalid_zipcode' });
    }

    const center = br.center || {};
    if (Number(center.lat) === 0 && Number(center.lng) === 0) {
      throw new HttpError(422, 'Distribution center coordinates are not configured.', { code: 'route_failed' });
    }

    if (!this.viaCepClient || !this.nominatimClient || !this.osrmClient) {
      throw new HttpError(503, 'Shipping providers are not available.', { code: 'upstream_unavailable' });
    }

    const viaCep = await this.viaCepClient.lookup(zipcode);
    if (viaCep.status === 'upstream') {
      throw new HttpError(503, 'Postal code service is temporarily unavailable.', { code: 'upstream_unavailable' });
    }
    if (viaCep.status !== 'ok') {
      throw new HttpError(404, 'Postal code not found.', { code: 'zipcode_not_found' });
    }

    const geo = await this.nominatimClient.geocodeBr({
      street: viaCep.address.street,
      neighborhood: viaCep.address.neighborhood,
      city: viaCep.address.city,
      state: viaCep.address.state,
      zipcode
    });
    if (geo.status !== 'ok') {
      throw new HttpError(422, 'Unable to locate this address for shipping.', { code: 'address_not_geocodable' });
    }

    const routed = await this.osrmClient.routeDriving(
      { lat: center.lat, lng: center.lng },
      { lat: geo.lat, lng: geo.lng },
      center.version
    );

    let source = 'osrm';
    let distanceM = routed.distanceM;
    if (routed.status !== 'ok') {
      source = 'haversine_fallback';
      distanceM = haversineMeters(
        { lat: center.lat, lng: center.lng },
        { lat: geo.lat, lng: geo.lng }
      );
      if (!(distanceM > 0)) {
        throw new HttpError(422, 'Unable to calculate shipping distance.', { code: 'route_failed' });
      }
    }

    const distanceKm = billableDistanceKm(distanceM, source, br.rule.road_factor);
    const maxDistance = Number(br.rule.max_distance_km);
    if (Number.isFinite(maxDistance) && maxDistance > 0 && distanceKm > maxDistance) {
      throw new HttpError(422, 'Delivery is not available for this distance.', {
        code: 'out_of_coverage',
        distance: distanceKm
      });
    }

    const fee = applyShippingFee(distanceKm, br.rule);
    const days = currentBrDeliveryDays();

    return this.withQuoteToken('BR', zipcode, {
      success: true,
      data: {
        distance: distanceKm,
        shipping: fee.shipping,
        delivery_days: days,
        currency: 'BRL',
        distance_source: source,
        quoted_at: new Date().toISOString(),
        label: br.label,
        distribution_center: {
          name: center.name,
          version: String(center.version || '')
        },
        breakdown: {
          per_km: Number(br.rule.per_km),
          distance_km: distanceKm,
          road_factor: Number(br.rule.road_factor),
          minimum_applied: fee.minimumApplied,
          maximum_applied: fee.maximumApplied,
          raw: fee.raw
        },
        destination: {
          zipcode: formatBrZipcode(zipcode),
          city: viaCep.address.city,
          state: viaCep.address.state
        }
      }
    });
  }
}

module.exports = {
  ShippingService
};
