const {
  normalizeRecipientName,
  parseRecipientNameInput,
  validateRecipientName
} = require('../src/core/recipient-name');

describe('validateRecipientName', () => {
  test.each([
    ['José', 'José'],
    ['Portaria', 'Portaria'],
    ['  Ana   Costa  ', 'Ana Costa'],
    ['Zoë', 'Zoë'],
    ['Portaria Ed. Sol', 'Portaria Ed. Sol']
  ])('accepts %p as %p', (input, expected) => {
    expect(validateRecipientName(input)).toBe(expected);
  });

  test.each([
    ['12'],
    ['a@b'],
    ['ana@example.com'],
    ['   '],
    [''],
    [null],
    ['A']
  ])('refuses %p', (input) => {
    expect(validateRecipientName(input)).toBeNull();
  });

  test('accepts 60 characters and refuses 61', () => {
    expect(validateRecipientName('a'.repeat(60))).toBe('a'.repeat(60));
    expect(validateRecipientName('a'.repeat(61))).toBeNull();
  });

  test('counts accented characters once', () => {
    expect(validateRecipientName('é'.repeat(60))).toBe('é'.repeat(60));
  });

  test('is not the fiscal name rule: one word is enough', () => {
    expect(validateRecipientName('Ana')).toBe('Ana');
  });
});

describe('normalizeRecipientName', () => {
  test('collapses spaces and returns null when empty', () => {
    expect(normalizeRecipientName(' João \t Lima ')).toBe('João Lima');
    expect(normalizeRecipientName('  ')).toBeNull();
  });
});

describe('parseRecipientNameInput', () => {
  test('keeps an omitted field as undefined', () => {
    expect(parseRecipientNameInput(undefined)).toBeUndefined();
  });

  test('requires the field when asked', () => {
    expect(() => parseRecipientNameInput(undefined, { required: true }))
      .toThrow(expect.objectContaining({ statusCode: 422, details: expect.objectContaining({ field: 'recipient_name' }) }));
  });

  test('refuses an empty string even when optional', () => {
    expect(() => parseRecipientNameInput('')).toThrow(expect.objectContaining({ statusCode: 422 }));
  });

  test('returns the normalized name', () => {
    expect(parseRecipientNameInput(' João  Lima ')).toBe('João Lima');
  });
});
