const net = require('node:net');

function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

function extractHost(value) {
  const raw = firstHeaderValue(value);
  if (!raw) {
    return '';
  }

  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      return new URL(raw).hostname.toLowerCase();
    }
  } catch {
    return '';
  }

  const bracketed = raw.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    return bracketed[1].toLowerCase();
  }

  const ipv4WithPort = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4WithPort) {
    return ipv4WithPort[1];
  }

  const hostPart = raw.split('/')[0].trim();
  if (net.isIP(hostPart)) {
    return hostPart.toLowerCase();
  }

  const portSeparator = hostPart.lastIndexOf(':');
  const hostname = portSeparator > -1 ? hostPart.slice(0, portSeparator) : hostPart;
  return hostname.toLowerCase().trim();
}

function detectDomainFromRequest(request = {}) {
  const headers = request.headers || {};
  const candidates = [
    headers.origin,
    headers.referer,
    headers['x-forwarded-host'],
    headers.host
  ];

  for (const candidate of candidates) {
    const host = extractHost(candidate);
    if (!host) {
      continue;
    }

    return host.endsWith('.com.br') ? 'com.br' : 'com';
  }

  return 'com';
}

function stripIpv4Mapped(ip) {
  const mapped = String(ip || '').trim().toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mapped ? mapped[1] : String(ip || '').trim();
}

function normalizeIp(value) {
  let ip = firstHeaderValue(value);
  if (!ip) {
    return '';
  }

  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    ip = bracketed[1];
  }

  ip = stripIpv4Mapped(ip);

  const ipv4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort) {
    ip = ipv4WithPort[1];
  }

  return net.isIP(ip) ? ip : '';
}

function isPublicIpv4(ip) {
  const octets = ip.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [a, b] = octets;

  if (a === 0 || a === 10 || a === 127 || a >= 224) {
    return false;
  }

  if (a === 169 && b === 254) {
    return false;
  }

  if (a === 172 && b >= 16 && b <= 31) {
    return false;
  }

  if (a === 192 && b === 168) {
    return false;
  }

  if (a === 100 && b >= 64 && b <= 127) {
    return false;
  }

  return true;
}

function isPublicIp(value) {
  const ip = normalizeIp(value);
  if (!ip) {
    return false;
  }

  if (net.isIPv4(ip)) {
    return isPublicIpv4(ip);
  }

  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') {
    return false;
  }

  if (normalized.startsWith('fe80:')) {
    return false;
  }

  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return false;
  }

  return true;
}

function splitForwardedFor(value) {
  return String(value || '')
    .split(',')
    .map((part) => normalizeIp(part))
    .filter(Boolean);
}

function remoteAddressFromRequest(request = {}) {
  if (request.socket && request.socket.remoteAddress) {
    return normalizeIp(request.socket.remoteAddress);
  }

  if (request.connection && request.connection.remoteAddress) {
    return normalizeIp(request.connection.remoteAddress);
  }

  return '';
}

function detectRequestIp(request = {}, options = {}) {
  const trustProxy = Boolean(options.trustProxy);
  const headers = request.headers || {};
  const candidates = [];

  if (trustProxy) {
    const cloudflareIp = normalizeIp(headers['cf-connecting-ip']);
    if (cloudflareIp) {
      candidates.push(cloudflareIp);
    }

    candidates.push(...splitForwardedFor(headers['x-forwarded-for']));
  }

  const remoteAddress = remoteAddressFromRequest(request);
  if (remoteAddress) {
    candidates.push(remoteAddress);
  }

  const publicIp = candidates.find((ip) => isPublicIp(ip));
  return publicIp || '';
}

function normalizeGeoCountry(value) {
  const country = String(value || '').trim().toUpperCase();

  if (!country || country === 'UNKNOWN') {
    return 'UNKNOWN';
  }

  if (country === 'US' || country === 'BR') {
    return country;
  }

  return 'OTHER';
}

module.exports = {
  extractHost,
  detectDomainFromRequest,
  detectRequestIp,
  isPublicIp,
  normalizeGeoCountry,
  normalizeIp
};
