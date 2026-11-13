const {
  parseDeliveryInstructionsInput,
  resolveDeliveryInstructions,
  sameDeliveryPlace,
  validateDeliveryInstructions
} = require('../src/core/delivery-instructions');

describe('delivery instructions rule', () => {
  test('normal text is trimmed and collapsed to one line', () => {
    expect(parseDeliveryInstructionsInput('  Portão azul,\n  tocar interfone 12  ')).toBe('Portão azul, tocar interfone 12');
  });

  test('too long is refused with field delivery_instructions', () => {
    expect(() => parseDeliveryInstructionsInput('a'.repeat(201))).toThrow(expect.objectContaining({
      statusCode: 422,
      details: expect.objectContaining({ field: 'delivery_instructions' })
    }));
    expect(parseDeliveryInstructionsInput('a'.repeat(200))).toHaveLength(200);
  });

  test('only spaces means no instructions', () => {
    expect(parseDeliveryInstructionsInput('   ')).toBe('');
  });

  test('an emoji counts as one character', () => {
    expect(parseDeliveryInstructionsInput(`${'a'.repeat(199)}🐶`)).toBe(`${'a'.repeat(199)}🐶`);
    expect(validateDeliveryInstructions(`${'a'.repeat(200)}🐶`)).toBeNull();
  });

  test('a control character is refused', () => {
    expect(validateDeliveryInstructions('Portão\u0000azul')).toBeNull();
  });

  test('omitted stays undefined, null clears, a number is refused', () => {
    expect(parseDeliveryInstructionsInput(undefined)).toBeUndefined();
    expect(parseDeliveryInstructionsInput(null)).toBe('');
    expect(() => parseDeliveryInstructionsInput(12)).toThrow();
  });
});

describe('resolveDeliveryInstructions', () => {
  const profileBr = { country: 'BR', zipcode: '01310100', street: 'rua  a', number: '10', delivery_instructions: 'Interfone 12' };

  test('subscription has its own', () => {
    expect(resolveDeliveryInstructions(
      { country: 'BR', zipcode: '01310-100', street: 'Rua A', number: '10', delivery_instructions: 'Portão verde' },
      profileBr
    )).toEqual({ text: 'Portão verde', source: 'subscription' });
  });

  test('old subscription at the profile address', () => {
    expect(resolveDeliveryInstructions(
      { country: 'BR', zipcode: '01310-100', street: 'Rua A', number: '10', delivery_instructions: '' },
      profileBr
    )).toEqual({ text: 'Interfone 12', source: 'profile' });
  });

  test('gift at another address without instructions', () => {
    expect(resolveDeliveryInstructions(
      { country: 'BR', zipcode: '04000-000', street: 'Rua B', number: '20' },
      profileBr
    )).toEqual({ text: null, source: null });
  });

  test('BR same ZIP and street but another number is another place', () => {
    expect(sameDeliveryPlace(
      { country: 'BR', zipcode: '01310-100', street: 'Rua A', number: '12' },
      profileBr
    )).toBe(false);
  });

  test('accents and case do not matter', () => {
    expect(sameDeliveryPlace(
      { country: 'BR', zipcode: '01310-100', street: 'Avenida São João', number: '5' },
      { country: 'BR', zipcode: '01310100', street: 'avenida sao joao', number: '5' }
    )).toBe(true);
  });

  test('US street with a different ZIP+4', () => {
    expect(resolveDeliveryInstructions(
      { country: 'US', postal_code: '10001-1234', line1: '100 Main St' },
      { country: 'US', zipcode: '10001', street: '100 main st', delivery_instructions: 'Leave at back door' }
    )).toEqual({ text: 'Leave at back door', source: 'profile' });
  });

  test('different country is another place', () => {
    expect(sameDeliveryPlace(
      { country: 'US', zipcode: '10001', street: '100 Main St' },
      { country: 'BR', zipcode: '10001', street: '100 Main St' }
    )).toBe(false);
  });

  test('neither has instructions', () => {
    expect(resolveDeliveryInstructions({ country: 'BR' }, null)).toEqual({ text: null, source: null });
  });
});
