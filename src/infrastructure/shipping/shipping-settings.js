const DEFAULT_SETTINGS = {
  br: {
    enabled: true,
    label: 'Entrega Eden Bowl',
    center: {
      name: 'CD',
      street: '',
      city: '',
      state: '',
      zipcode: '',
      lat: -25.44839,
      lng: -49.21741,
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

  if (typeof value === 'number') {
    return value !== 0;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function mergeSettings(base, overlay) {
  const fileBr = overlay && overlay.br ? overlay.br : {};
  const fileUs = overlay && overlay.us ? overlay.us : {};
  const fileCenter = fileBr.center || {};
  const fileRule = fileBr.rule || {};
  const baseCenter = (base && base.br && base.br.center) || DEFAULT_SETTINGS.br.center;
  const baseRule = (base && base.br && base.br.rule) || DEFAULT_SETTINGS.br.rule;
  const baseBr = (base && base.br) || DEFAULT_SETTINGS.br;
  const baseUs = (base && base.us) || DEFAULT_SETTINGS.us;

  return {
    br: {
      enabled: fileBr.enabled == null ? Boolean(baseBr.enabled) : Boolean(fileBr.enabled),
      label: fileBr.label || baseBr.label,
      center: {
        name: fileCenter.name || baseCenter.name,
        street: fileCenter.street == null ? (baseCenter.street || '') : String(fileCenter.street),
        city: fileCenter.city == null ? (baseCenter.city || '') : String(fileCenter.city),
        state: fileCenter.state == null ? (baseCenter.state || '') : String(fileCenter.state),
        zipcode: fileCenter.zipcode == null ? (baseCenter.zipcode || '') : String(fileCenter.zipcode),
        lat: toNumber(fileCenter.lat, toNumber(baseCenter.lat, 0)),
        lng: toNumber(fileCenter.lng, toNumber(baseCenter.lng, 0)),
        version: String(fileCenter.version || baseCenter.version || '1')
      },
      rule: {
        per_km: toNumber(fileRule.per_km, baseRule.per_km),
        road_factor: toNumber(fileRule.road_factor, baseRule.road_factor),
        min_fee: toNumber(fileRule.min_fee, baseRule.min_fee),
        max_fee: fileRule.max_fee == null ? (baseRule.max_fee == null ? null : toNumber(baseRule.max_fee, null)) : toNumber(fileRule.max_fee, null),
        max_distance_km: toNumber(fileRule.max_distance_km, baseRule.max_distance_km),
        km_per_day: toNumber(fileRule.km_per_day, baseRule.km_per_day),
        min_days: toNumber(fileRule.min_days, baseRule.min_days),
        max_days: toNumber(fileRule.max_days, baseRule.max_days)
      }
    },
    us: {
      enabled: fileUs.enabled == null ? Boolean(baseUs.enabled) : Boolean(fileUs.enabled),
      cost: toNumber(fileUs.cost, baseUs.cost),
      label: fileUs.label || baseUs.label,
      carrier: fileUs.carrier || baseUs.carrier,
      delivery: fileUs.delivery || baseUs.delivery
    }
  };
}

function nextSettings(currentInput = {}, payload = {}) {
  const current = mergeSettings(DEFAULT_SETTINGS, currentInput);
  const nextBr = payload.br || {};
  const nextUs = payload.us || {};
  const nextCenter = nextBr.center || {};
  const nextRule = nextBr.rule || {};
  const latChanged = nextCenter.lat != null && Number(nextCenter.lat) !== Number(current.br.center.lat);
  const lngChanged = nextCenter.lng != null && Number(nextCenter.lng) !== Number(current.br.center.lng);
  const nextVersion = latChanged || lngChanged
    ? String(Number(current.br.center.version || 1) + 1)
    : current.br.center.version;

  return mergeSettings(current, {
    br: {
      enabled: nextBr.enabled == null ? current.br.enabled : Boolean(nextBr.enabled),
      label: nextBr.label == null ? current.br.label : nextBr.label,
      center: {
        ...current.br.center,
        ...nextCenter,
        version: nextVersion
      },
      rule: {
        ...current.br.rule,
        ...nextRule
      }
    },
    us: {
      ...current.us,
      ...nextUs
    }
  });
}

function brFromRow(row) {
  if (!row) {
    return {};
  }

  return {
    enabled: toBoolean(row.enabled, true),
    label: row.label,
    center: {
      name: row.center_name,
      street: row.center_street || '',
      city: row.center_city || '',
      state: row.center_state || '',
      zipcode: row.center_zipcode || '',
      lat: toNumber(row.center_lat, DEFAULT_SETTINGS.br.center.lat),
      lng: toNumber(row.center_lng, DEFAULT_SETTINGS.br.center.lng),
      version: String(row.center_version || '1')
    },
    rule: {
      per_km: toNumber(row.per_km, DEFAULT_SETTINGS.br.rule.per_km),
      road_factor: toNumber(row.road_factor, DEFAULT_SETTINGS.br.rule.road_factor),
      min_fee: toNumber(row.min_fee, DEFAULT_SETTINGS.br.rule.min_fee),
      max_fee: row.max_fee == null || row.max_fee === '' ? null : toNumber(row.max_fee, null),
      max_distance_km: toNumber(row.max_distance_km, DEFAULT_SETTINGS.br.rule.max_distance_km),
      km_per_day: toNumber(row.km_per_day, DEFAULT_SETTINGS.br.rule.km_per_day),
      min_days: toNumber(row.min_days, DEFAULT_SETTINGS.br.rule.min_days),
      max_days: toNumber(row.max_days, DEFAULT_SETTINGS.br.rule.max_days)
    }
  };
}

function usFromRow(row) {
  if (!row) {
    return {};
  }

  return {
    enabled: toBoolean(row.enabled, true),
    cost: toNumber(row.cost, DEFAULT_SETTINGS.us.cost),
    label: row.label,
    carrier: row.carrier,
    delivery: row.delivery
  };
}

function settingsFromRows(brRow, usRow) {
  return mergeSettings(DEFAULT_SETTINGS, {
    br: brFromRow(brRow),
    us: usFromRow(usRow)
  });
}

function brToParams(br) {
  return [
    br.enabled ? 1 : 0,
    br.label,
    br.center.name,
    br.center.street || '',
    br.center.city || '',
    br.center.state || '',
    br.center.zipcode || '',
    br.center.lat,
    br.center.lng,
    String(br.center.version || '1'),
    br.rule.per_km,
    br.rule.road_factor,
    br.rule.min_fee,
    br.rule.max_fee,
    br.rule.max_distance_km,
    br.rule.km_per_day,
    br.rule.min_days,
    br.rule.max_days
  ];
}

function usToParams(us) {
  return [
    us.enabled ? 1 : 0,
    us.cost,
    us.label,
    us.carrier,
    us.delivery
  ];
}

function loadShippingSettings() {
  return mergeSettings(DEFAULT_SETTINGS, {});
}

module.exports = {
  DEFAULT_SETTINGS,
  brToParams,
  loadShippingSettings,
  mergeSettings,
  nextSettings,
  settingsFromRows,
  toBoolean,
  toNumber,
  usToParams
};
