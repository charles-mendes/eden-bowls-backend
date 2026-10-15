const { ShippingHeadquartersService } = require('../src/services/shipping-headquarters.service');

const BR_HQ = {
  street: 'Avenida Paulista',
  number: '1000',
  complement: 'Sala 5',
  neighborhood: '',
  city: 'Sao Paulo',
  state: 'sp',
  zipcode: '01310100'
};

function viaCep(status = 'ok') {
  return {
    lookup: jest.fn().mockResolvedValue(status === 'ok'
      ? { status, address: { street: 'Avenida Paulista', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', zipcode: '01310100' } }
      : { status })
  };
}

function nominatim({ exact = { status: 'ok', lat: -23.5652, lng: -46.6514, label: 'Avenida Paulista, 1000' }, byZip = { status: 'ok', lat: -23.56, lng: -46.65 } } = {}) {
  return {
    geocodeBrAddress: jest.fn().mockResolvedValue(exact),
    geocodeBr: jest.fn().mockResolvedValue(byZip)
  };
}

describe('ShippingHeadquartersService › Brazil', () => {
  test('finds the coordinates from the address, number included', async () => {
    const nominatimClient = nominatim();
    const service = new ShippingHeadquartersService({ viaCepClient: viaCep(), nominatimClient });

    const result = await service.validateBr(BR_HQ);

    expect(result.valid).toBe(true);
    expect(result.address).toMatchObject({ city: 'São Paulo', state: 'SP', zipcode: '01310-100', neighborhood: 'Bela Vista' });
    expect(result.location).toMatchObject({ lat: -23.5652, lng: -46.6514, precision: 'address' });
    expect(nominatimClient.geocodeBrAddress).toHaveBeenCalledWith(expect.objectContaining({ number: '1000', street: 'Avenida Paulista' }));
  });

  test('falls back to the CEP position and says so', async () => {
    const service = new ShippingHeadquartersService({ viaCepClient: viaCep(), nominatimClient: nominatim({ exact: { status: 'not_found' } }) });

    const result = await service.validateBr(BR_HQ);

    expect(result.valid).toBe(true);
    expect(result.location.precision).toBe('zipcode');
    expect(result.warnings).toHaveLength(1);
  });

  test('refuses a CEP from another city', async () => {
    const service = new ShippingHeadquartersService({ viaCepClient: viaCep(), nominatimClient: nominatim() });

    const result = await service.validateBr({ ...BR_HQ, city: 'Curitiba' });

    expect(result.valid).toBe(false);
    expect(result.errors.city).toContain('São Paulo');
  });

  test('lists the missing fields without calling any provider', async () => {
    const viaCepClient = viaCep();
    const service = new ShippingHeadquartersService({ viaCepClient, nominatimClient: nominatim() });

    const result = await service.validateBr({ zipcode: '123' });

    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(['city', 'number', 'state', 'street', 'zipcode']);
    expect(viaCepClient.lookup).not.toHaveBeenCalled();
  });

  test('refuses a CEP that does not exist', async () => {
    const service = new ShippingHeadquartersService({ viaCepClient: viaCep('not_found'), nominatimClient: nominatim() });

    const result = await service.validateBr(BR_HQ);

    expect(result).toMatchObject({ valid: false, errors: { zipcode: 'CEP não encontrado.' } });
  });
});

describe('ShippingHeadquartersService › United States', () => {
  const US_HQ = { street: '350 5th Ave', street2: 'Suite 100', city: 'New York', state: 'ny', zipcode: '10118' };

  function zippopotam(address = { city: 'New York', state: 'NY' }) {
    return { lookupUs: jest.fn().mockResolvedValue(address ? { status: 'ok', address } : { status: 'not_found' }) };
  }

  test('accepts an address whose ZIP matches the state and asks UPS to confirm it', async () => {
    const upsClient = {
      envName: 'cie',
      isConfigured: () => true,
      validateAddress: jest.fn().mockResolvedValue({ status: 'valid', candidates: [] })
    };
    const service = new ShippingHeadquartersService({ zippopotamClient: zippopotam(), upsClient });

    const result = await service.validateUs(US_HQ);

    expect(result).toMatchObject({ valid: true, address: { state: 'NY', street2: 'Suite 100' }, ups: { status: 'valid' } });
    expect(result.warnings).toEqual([]);
  });

  test('refuses a ZIP from another state', async () => {
    const service = new ShippingHeadquartersService({ zippopotamClient: zippopotam({ city: 'Miami', state: 'FL' }) });

    const result = await service.validateUs(US_HQ);

    expect(result.valid).toBe(false);
    expect(result.errors.state).toContain('FL');
  });

  test('skips UPS on CIE outside New York and California', async () => {
    const upsClient = { envName: 'cie', isConfigured: () => true, validateAddress: jest.fn() };
    const service = new ShippingHeadquartersService({ zippopotamClient: zippopotam({ city: 'Miami', state: 'FL' }), upsClient });

    const result = await service.validateUs({ street: '100 Main St', city: 'Miami', state: 'FL', zipcode: '33101' });

    expect(result.ups).toMatchObject({ status: 'skipped', reason: 'sandbox_state_unsupported' });
    expect(upsClient.validateAddress).not.toHaveBeenCalled();
  });

  test('accepts ZIP+4 and refuses a malformed ZIP', async () => {
    const service = new ShippingHeadquartersService({ zippopotamClient: zippopotam() });

    await expect(service.validateUs({ ...US_HQ, zipcode: '10118-0110' })).resolves.toMatchObject({ valid: true, address: { zipcode: '10118-0110' } });
    await expect(service.validateUs({ ...US_HQ, zipcode: '1011' })).resolves.toMatchObject({ valid: false, errors: { zipcode: expect.any(String) } });
  });
});
