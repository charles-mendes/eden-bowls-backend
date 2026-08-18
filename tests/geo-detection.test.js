const {
  detectDomainFromRequest,
  detectRequestIp,
  extractHost,
  isPublicIp,
  normalizeGeoCountry
} = require('../src/core/geo-detection');

describe('geo detection', () => {
  test('extracts host from URL, host:port and raw hostname', () => {
    expect(extractHost('https://www.edenbowls.com.br/plan')).toBe('www.edenbowls.com.br');
    expect(extractHost('edenbowls.com:443')).toBe('edenbowls.com');
    expect(extractHost('www.edenbowls.com.br')).toBe('www.edenbowls.com.br');
  });

  test('resolves .com.br from Origin and falls back to com', () => {
    expect(detectDomainFromRequest({
      headers: { origin: 'https://www.edenbowls.com.br' }
    })).toBe('com.br');
    expect(detectDomainFromRequest({
      headers: { origin: 'http://localhost:5173' }
    })).toBe('com');
    expect(detectDomainFromRequest({ headers: {} })).toBe('com');
  });

  test('prefers Origin over Referer, X-Forwarded-Host and Host', () => {
    expect(detectDomainFromRequest({
      headers: {
        origin: 'https://www.edenbowls.com',
        referer: 'https://www.edenbowls.com.br/plan',
        'x-forwarded-host': 'www.edenbowls.com.br',
        host: 'www.edenbowls.com.br'
      }
    })).toBe('com');

    expect(detectDomainFromRequest({
      headers: {
        referer: 'https://www.edenbowls.com.br/plan',
        'x-forwarded-host': 'www.edenbowls.com',
        host: 'www.edenbowls.com'
      }
    })).toBe('com.br');
  });

  test('normalizes MaxMind ISO codes to US, BR, OTHER or UNKNOWN', () => {
    expect(normalizeGeoCountry('us')).toBe('US');
    expect(normalizeGeoCountry('BR')).toBe('BR');
    expect(normalizeGeoCountry('DE')).toBe('OTHER');
    expect(normalizeGeoCountry('')).toBe('UNKNOWN');
    expect(normalizeGeoCountry('UNKNOWN')).toBe('UNKNOWN');
  });

  test('treats loopback and private addresses as non-public', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicIp('10.0.0.8')).toBe(false);
    expect(isPublicIp('192.168.1.10')).toBe(false);
    expect(isPublicIp('8.8.8.8')).toBe(true);
  });

  test('ignores proxy headers unless trustProxy is enabled', () => {
    const request = {
      headers: {
        'cf-connecting-ip': '8.8.8.8',
        'x-forwarded-for': '200.221.2.45, 10.0.0.1'
      },
      socket: { remoteAddress: '127.0.0.1' }
    };

    expect(detectRequestIp(request, { trustProxy: false })).toBe('');
    expect(detectRequestIp(request, { trustProxy: true })).toBe('8.8.8.8');
  });

  test('uses the first public X-Forwarded-For IP when Cloudflare header is absent', () => {
    expect(detectRequestIp({
      headers: { 'x-forwarded-for': '10.0.0.1, 200.221.2.45' },
      socket: { remoteAddress: '127.0.0.1' }
    }, { trustProxy: true })).toBe('200.221.2.45');
  });
});
