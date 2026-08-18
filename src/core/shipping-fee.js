const EARTH_RADIUS_M = 6371000;

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function toRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

function haversineMeters(origin, destination) {
  const lat1 = Number(origin && origin.lat);
  const lng1 = Number(origin && origin.lng);
  const lat2 = Number(destination && destination.lat);
  const lng2 = Number(destination && destination.lng);

  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) {
    return 0;
  }

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

  return EARTH_RADIUS_M * c;
}

function billableDistanceKm(distanceMeters, source, roadFactor = 1.3) {
  const meters = Math.max(0, Number(distanceMeters) || 0);
  let km = meters / 1000;

  if (source === 'haversine_fallback') {
    const factor = Math.max(0.01, Number(roadFactor) || 1.3);
    km *= factor;
  }

  return roundTo(km, 2);
}

function applyShippingFee(distanceKm, rule = {}) {
  const perKm = Number(rule.per_km);
  const rate = Number.isFinite(perKm) ? perKm : 0.95;
  const raw = roundTo(Number(distanceKm) * rate, 4);
  let shipping = raw;
  const minFee = Number(rule.min_fee);
  const maxFee = rule.max_fee == null || rule.max_fee === '' ? null : Number(rule.max_fee);

  if (Number.isFinite(minFee) && minFee > 0 && shipping < minFee) {
    shipping = minFee;
  }

  if (maxFee != null && Number.isFinite(maxFee) && maxFee >= 0 && shipping > maxFee) {
    shipping = maxFee;
  }

  const rounded = roundTo(shipping, 2);

  return {
    shipping: rounded,
    raw: roundTo(raw, 2),
    minimumApplied: Number.isFinite(minFee) && minFee > 0 && rounded === roundTo(minFee, 2) && raw < minFee,
    maximumApplied: maxFee != null && Number.isFinite(maxFee) && maxFee >= 0 && rounded === roundTo(maxFee, 2) && raw > maxFee
  };
}

function deliveryDays(distanceKm, rule = {}) {
  const kmPerDay = Math.max(0.0001, Number(rule.km_per_day) || 80);
  const minDays = Number(rule.min_days);
  const maxDays = Number(rule.max_days);
  let days = Math.ceil(Number(distanceKm) / kmPerDay);

  if (Number.isFinite(minDays)) {
    days = Math.max(minDays, days);
  }

  if (Number.isFinite(maxDays) && maxDays > 0) {
    days = Math.min(maxDays, days);
  }

  return Math.max(1, days);
}

function formatBrZipcode(cep8) {
  const digits = String(cep8 || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) {
    return digits;
  }

  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

module.exports = {
  EARTH_RADIUS_M,
  applyShippingFee,
  billableDistanceKm,
  deliveryDays,
  formatBrZipcode,
  haversineMeters,
  roundTo
};
