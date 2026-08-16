const { MARKETS, convertWeight, formatMass, formatPacks, formatPetForMarket, resolveMarket } = require('../src/core/market');
const { parseRequestMarket } = require('../src/api/validators/market.validator');

describe('market helpers', () => {
  test('resolves US from .com and BR from .com.br', () => {
    expect(resolveMarket({ domain: 'com' })).toEqual(MARKETS.US);
    expect(resolveMarket({ domain: 'com.br' })).toEqual(MARKETS.BR);
    expect(resolveMarket({ country: 'BR' })).toEqual(MARKETS.BR);
    expect(resolveMarket({})).toEqual(MARKETS.US);
  });

  test('domain wins over a conflicting country', () => {
    expect(resolveMarket({ country: 'US', domain: 'com.br' })).toEqual(MARKETS.BR);
    expect(resolveMarket({ country: 'BR', domain: 'com' })).toEqual(MARKETS.US);
  });

  test('formats mass and packs for each market', () => {
    expect(formatMass(6000, MARKETS.US)).toBe('6,000 g');
    expect(formatMass(6000, MARKETS.BR)).toBe('6.000 g');
    expect(formatPacks(2, MARKETS.US)).toBe('2 packs');
    expect(formatPacks(2, MARKETS.BR)).toBe('2 pacotes');
  });

  test('converts pet weight to the chosen market unit', () => {
    const pet = formatPetForMarket({ weight_input: 10, weight: 10, weight_unit: 'kg' }, MARKETS.US);
    expect(pet.weight_unit).toBe('lb');
    expect(pet.weight).toBe(convertWeight(10, 'kg', 'lb'));
  });

  test('reads country from query, body or header', () => {
    expect(parseRequestMarket({ query: { country: 'BR' }, headers: {} }).country).toBe('BR');
    expect(parseRequestMarket({ query: {}, headers: { 'x-eden-country': 'BR' } }).country).toBe('BR');
    expect(parseRequestMarket({ query: {}, headers: {} }, { country: 'BR' }).country).toBe('BR');
    expect(parseRequestMarket({ query: {}, headers: { 'x-eden-domain': 'com.br' } }).country).toBe('BR');
  });

  test('rejects an invalid country', () => {
    expect(() => parseRequestMarket({ query: { country: 'PT' }, headers: {} })).toThrow('Invalid country.');
  });
});
