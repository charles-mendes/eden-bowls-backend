const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  br: {
    enabled: true,
    label: 'Entrega Eden Bowl',
    center: {
      name: 'CD',
      lat: 0,
      lng: 0,
      version: '1'
    },
    rule: {
      per_km: 0.95,
      road_factor: 1.3,
      min_fee: 0,
      max_fee: null,
      max_distance_km: 500,
      km_per_day: 80,
      min_days: 2,
      max_days: 10
    }
  },
  us: {
    enabled: true,
    cost: 12.9,
    label: 'FedEx 3–5 business days',
    carrier: 'FedEx',
    delivery: '3–5 business days'
  }
};

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function mergeSettings(base, overlay) {
  const fileBr = overlay && overlay.br ? overlay.br : {};
  const fileUs = overlay && overlay.us ? overlay.us : {};
  const fileCenter = fileBr.center || {};
  const fileRule = fileBr.rule || {};

  return {
    br: {
      enabled: fileBr.enabled == null ? base.br.enabled : Boolean(fileBr.enabled),
      label: fileBr.label || base.br.label,
      center: {
        name: fileCenter.name || base.br.center.name,
        lat: toNumber(fileCenter.lat, base.br.center.lat),
        lng: toNumber(fileCenter.lng, base.br.center.lng),
        version: String(fileCenter.version || base.br.center.version)
      },
      rule: {
        per_km: toNumber(fileRule.per_km, base.br.rule.per_km),
        road_factor: toNumber(fileRule.road_factor, base.br.rule.road_factor),
        min_fee: toNumber(fileRule.min_fee, base.br.rule.min_fee),
        max_fee: fileRule.max_fee == null ? base.br.rule.max_fee : toNumber(fileRule.max_fee, null),
        max_distance_km: toNumber(fileRule.max_distance_km, base.br.rule.max_distance_km),
        km_per_day: toNumber(fileRule.km_per_day, base.br.rule.km_per_day),
        min_days: toNumber(fileRule.min_days, base.br.rule.min_days),
        max_days: toNumber(fileRule.max_days, base.br.rule.max_days)
      }
    },
    us: {
      enabled: fileUs.enabled == null ? base.us.enabled : Boolean(fileUs.enabled),
      cost: toNumber(fileUs.cost, base.us.cost),
      label: fileUs.label || base.us.label,
      carrier: fileUs.carrier || base.us.carrier,
      delivery: fileUs.delivery || base.us.delivery
    }
  };
}

function overlayEnv(settings, env = {}) {
  return {
    br: {
      ...settings.br,
      enabled: env.SHIPPING_BR_ENABLED == null ? settings.br.enabled : toBoolean(env.SHIPPING_BR_ENABLED, settings.br.enabled),
      label: env.SHIPPING_BR_LABEL || settings.br.label,
      center: {
        ...settings.br.center,
        name: env.SHIPPING_BR_CENTER_NAME || settings.br.center.name,
        lat: toNumber(env.SHIPPING_BR_CENTER_LAT, settings.br.center.lat),
        lng: toNumber(env.SHIPPING_BR_CENTER_LNG, settings.br.center.lng),
        version: env.SHIPPING_BR_CENTER_VERSION || settings.br.center.version
      },
      rule: {
        ...settings.br.rule,
        per_km: toNumber(env.SHIPPING_BR_PER_KM, settings.br.rule.per_km),
        road_factor: toNumber(env.SHIPPING_BR_ROAD_FACTOR, settings.br.rule.road_factor),
        min_fee: toNumber(env.SHIPPING_BR_MIN_FEE, settings.br.rule.min_fee),
        max_fee: env.SHIPPING_BR_MAX_FEE === undefined ? settings.br.rule.max_fee : toNumber(env.SHIPPING_BR_MAX_FEE, null),
        max_distance_km: toNumber(env.SHIPPING_BR_MAX_DISTANCE_KM, settings.br.rule.max_distance_km),
        km_per_day: toNumber(env.SHIPPING_BR_KM_PER_DAY, settings.br.rule.km_per_day),
        min_days: toNumber(env.SHIPPING_BR_MIN_DAYS, settings.br.rule.min_days),
        max_days: toNumber(env.SHIPPING_BR_MAX_DAYS, settings.br.rule.max_days)
      }
    },
    us: {
      ...settings.us,
      enabled: env.SHIPPING_US_ENABLED == null ? settings.us.enabled : toBoolean(env.SHIPPING_US_ENABLED, settings.us.enabled),
      cost: toNumber(env.SHIPPING_US_COST, settings.us.cost),
      label: env.SHIPPING_US_LABEL || settings.us.label,
      carrier: env.SHIPPING_US_CARRIER || settings.us.carrier,
      delivery: env.SHIPPING_US_DELIVERY || settings.us.delivery
    }
  };
}

function loadShippingSettings(options = {}) {
  const filePath = options.filePath || path.resolve(process.cwd(), 'data/shipping-settings.json');
  const fromFile = options.settings || readJsonFile(filePath);
  return overlayEnv(mergeSettings(DEFAULT_SETTINGS, fromFile), options.env || {});
}

module.exports = {
  DEFAULT_SETTINGS,
  loadShippingSettings
};
