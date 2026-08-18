const { fetchJson } = require('../http/fetch-json');

const ROUTE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function formatCoord(value) {
  return Number(value).toFixed(6);
}

function cacheCoord(value) {
  return Number(value).toFixed(4);
}

class OsrmClient {
  constructor(options = {}) {
    this.cache = options.cache || null;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs || 5000;
    this.baseUrl = options.baseUrl || 'https://router.project-osrm.org';
  }

  async routeDriving(origin, destination, centerVersion = '1') {
    const originLat = Number(origin && origin.lat);
    const originLng = Number(origin && origin.lng);
    const destLat = Number(destination && destination.lat);
    const destLng = Number(destination && destination.lng);

    if (![originLat, originLng, destLat, destLng].every(Number.isFinite)) {
      return { status: 'failed' };
    }

    const cacheKey = `route:${centerVersion}:${cacheCoord(destLat)},${cacheCoord(destLng)}`;
    if (this.cache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const path = `${formatCoord(originLng)},${formatCoord(originLat)};${formatCoord(destLng)},${formatCoord(destLat)}`;
    const response = await fetchJson(`${this.baseUrl}/route/v1/driving/${path}?overview=false`, {
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      headers: { Accept: 'application/json' }
    });

    const route = response.body && Array.isArray(response.body.routes) ? response.body.routes[0] : null;
    const distanceM = route ? Number(route.distance) : NaN;
    const durationS = route ? Number(route.duration) : 0;

    if (!response.ok || String(response.body && response.body.code || '') !== 'Ok' || !Number.isFinite(distanceM)) {
      return { status: 'failed' };
    }

    const result = {
      status: 'ok',
      distanceM,
      durationS: Number.isFinite(durationS) ? durationS : 0,
      source: 'osrm'
    };

    if (this.cache) {
      this.cache.set(cacheKey, result, ROUTE_TTL_MS);
    }

    return result;
  }
}

module.exports = {
  OsrmClient,
  ROUTE_TTL_MS
};
