const { HttpError } = require('../core/http-error');
const {
  applyShippingFee,
  billableDistanceKm,
  deliveryDays,
  formatBrZipcode,
  haversineMeters
} = require('../core/shipping-fee');
const { loadShippingSettings } = require('../infrastructure/shipping/shipping-settings');

class ShippingService {
  constructor(options = {}) {
    this.settings = options.settings || loadShippingSettings();
    this.viaCepClient = options.viaCepClient || null;
    this.nominatimClient = options.nominatimClient || null;
    this.osrmClient = options.osrmClient || null;
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
          currency: 'USD'
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

  async calculate(payload = {}) {
    const country = String(payload.country || 'BR').trim().toUpperCase();
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
    const days = deliveryDays(distanceKm, br.rule);

    return {
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
    };
  }
}

module.exports = {
  ShippingService
};
