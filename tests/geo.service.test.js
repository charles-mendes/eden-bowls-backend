const { GeoService } = require('../src/services/geo.service');
const { MaxMindCountryReader } = require('../src/infrastructure/geo/maxmind-country-reader');

function publicIpRequest(overrides = {}) {
  return {
    headers: {
      origin: 'https://www.edenbowls.com',
      ...(overrides.headers || {})
    },
    socket: {
      remoteAddress: '8.8.8.8',
      ...(overrides.socket || {})
    }
  };
}

describe('GeoService', () => {
  test('returns UNKNOWN and empty ip when only a private address is present', async () => {
    const service = new GeoService({
      countryReader: { lookupIsoCode: jest.fn() }
    });

    const payload = await service.getContext({
      headers: { origin: 'http://localhost:5173' },
      socket: { remoteAddress: '127.0.0.1' }
    });

    expect(payload).toEqual({
      success: true,
      data: {
        domain: 'com',
        country: 'UNKNOWN',
        ip: '',
        region: null,
        source: 'backend',
        presetId: null
      }
    });
  });

  test('looks up a public IP and keeps region and presetId null', async () => {
    const countryReader = {
      lookupIsoCode: jest.fn().mockResolvedValue('BR')
    };
    const service = new GeoService({ countryReader, trustProxy: false });

    const payload = await service.getContext(publicIpRequest({
      headers: { origin: 'https://www.edenbowls.com.br' }
    }));

    expect(countryReader.lookupIsoCode).toHaveBeenCalledWith('8.8.8.8');
    expect(payload.data).toEqual({
      domain: 'com.br',
      country: 'BR',
      ip: '8.8.8.8',
      region: null,
      source: 'backend',
      presetId: null
    });
  });

  test('turns reader failures into UNKNOWN without throwing', async () => {
    const service = new GeoService({
      countryReader: {
        lookupIsoCode: jest.fn().mockRejectedValue(new Error('mmdb missing'))
      }
    });

    const payload = await service.getContext(publicIpRequest());

    expect(payload.data.country).toBe('UNKNOWN');
    expect(payload.data.ip).toBe('8.8.8.8');
    expect(payload.success).toBe(true);
  });

  test('MaxMindCountryReader degrades when the database cannot be opened', async () => {
    const reader = new MaxMindCountryReader({
      dbPath: './data/missing-GeoLite2-Country.mmdb'
    });

    await reader.open();

    expect(reader.isOpen()).toBe(false);
    await expect(reader.lookupIsoCode('8.8.8.8')).resolves.toBe('');
  });

  test('MaxMindCountryReader reads iso_code from an injected lookup', async () => {
    const reader = new MaxMindCountryReader({
      dbPath: './data/GeoLite2-Country.mmdb',
      openDatabase: async () => ({
        get: (ip) => (ip === '8.8.8.8' ? { country: { iso_code: 'US' } } : null)
      })
    });

    await reader.open();

    expect(reader.isOpen()).toBe(true);
    await expect(reader.lookupIsoCode('8.8.8.8')).resolves.toBe('US');
    await expect(reader.lookupIsoCode('1.1.1.1')).resolves.toBe('');
  });
});
