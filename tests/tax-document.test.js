const { parseCpf, parseFiscalName, parseTaxDocument } = require('../src/core/tax-document');

describe('parseTaxDocument', () => {
  test('accepts a valid CPF and CNPJ, with or without punctuation', () => {
    expect(parseTaxDocument('529.982.247-25')).toEqual({ digits: '52998224725', kind: 'cpf' });
    expect(parseTaxDocument('11.222.333/0001-81')).toEqual({ digits: '11222333000181', kind: 'cnpj' });
  });

  test.each(['', null, '12345678901', '11111111111', '52998224724', '11222333000182', '123'])('refuses %s', (value) => {
    expect(parseTaxDocument(value)).toBeNull();
  });
});

describe('parseCpf', () => {
  test('accepts a CPF and refuses a valid CNPJ', () => {
    expect(parseCpf('529.982.247-25')).toBe('52998224725');
    expect(parseCpf('11.222.333/0001-81')).toBeNull();
  });
});

describe('parseFiscalName', () => {
  test('needs two words and fits the note field', () => {
    expect(parseFiscalName('  Maria   da Silva ')).toBe('Maria da Silva');
    expect(parseFiscalName('Maria')).toBeNull();
    expect(parseFiscalName(`Maria ${'a'.repeat(60)}`)).toBeNull();
  });
});
