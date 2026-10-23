const { labelCompleteness, parseRecipeKey, parseRecipeLabel } = require('../src/core/recipe-content');

function label(overrides = {}) {
  return parseRecipeLabel({
    productName: 'Fresh Frozen Dog Food – Beef Recipe',
    ingredients: ['Potatoes', 'Beef'],
    analysis: [{ nutrient: 'Crude Protein (min)', value: '9.0%' }, { nutrient: 'Crude Fat (min)', value: '3.0%' }],
    energyKg: '1,200 kcal/kg',
    energyPackage: '360 kcal per package',
    notices: [
      'This product is intended for intermittent or supplemental feeding only.',
      'Not formulated to meet AAFCO nutrient profiles for complete and balanced nutrition.'
    ],
    ...overrides
  });
}

describe('labelCompleteness', () => {
  test('a US label with the current two notices is complete', () => {
    expect(labelCompleteness(label(), 'US')).toEqual({ status: 'complete', missing: [] });
  });

  test('a US label without notices is incomplete and names them', () => {
    expect(labelCompleteness(label({ notices: [] }), 'US')).toEqual({ status: 'incomplete', missing: ['notices'] });
  });

  test('any notice text counts, such as a growth AAFCO statement', () => {
    const growth = label({ notices: ['Formulated to meet the AAFCO Dog Food Nutrient Profiles for growth.'] });
    expect(labelCompleteness(growth, 'US').status).toBe('complete');
  });

  test('a BR label without notices is complete', () => {
    expect(labelCompleteness(label({ notices: [] }), 'BR')).toEqual({ status: 'complete', missing: [] });
  });

  test('names each missing item', () => {
    const empty = parseRecipeLabel({ productName: 'Only a name' });
    expect(labelCompleteness(empty, 'US')).toEqual({
      status: 'incomplete',
      missing: ['ingredients', 'analysis', 'energyKg', 'energyPackage', 'notices']
    });
  });

  test('no stored label is missing', () => {
    expect(labelCompleteness(null, 'US')).toEqual({ status: 'missing', missing: [] });
  });
});

describe('parseRecipeLabel', () => {
  test('trims text, drops blank rows and ignores unknown keys', () => {
    const parsed = parseRecipeLabel({
      productName: '  Beef  ',
      ingredients: ['Beef', '  ', 'Rice'],
      analysis: [{ nutrient: 'Moisture (max)', value: '74.0%' }, { nutrient: '', value: '' }],
      title: 'not a label field'
    });

    expect(parsed.productName).toBe('Beef');
    expect(parsed.ingredients).toEqual(['Beef', 'Rice']);
    expect(parsed.analysis).toEqual([{ nutrient: 'Moisture (max)', value: '74.0%' }]);
    expect(parsed.title).toBeUndefined();
    expect(parsed.notices).toEqual([]);
  });

  test.each([
    [{ productName: 'x'.repeat(501) }, 'productName'],
    [{ ingredients: Array.from({ length: 41 }, (_, index) => `item ${index}`) }, 'ingredients'],
    [{ analysis: [{ nutrient: 'Crude Fat (min)', value: '' }] }, 'analysis[0]'],
    [{ notices: 'one notice' }, 'notices'],
    [{ energyKg: 1200 }, 'energyKg']
  ])('refuses %j', (input, field) => {
    expect(() => parseRecipeLabel(input)).toThrow(expect.objectContaining({
      statusCode: 422,
      details: { code: 'recipe_label_invalid', field }
    }));
  });
});

describe('parseRecipeKey', () => {
  test('keeps a lowercase slug', () => {
    expect(parseRecipeKey(' senior-beef ')).toBe('senior-beef');
  });

  test.each([null, undefined, '', '   '])('%j means no recipe', (value) => {
    expect(parseRecipeKey(value)).toBeNull();
  });

  test.each(['Beef Recipe', 'beef--chicken', '-beef', 'carne_bovina', 'a'.repeat(65)])('refuses %j', (value) => {
    expect(() => parseRecipeKey(value)).toThrow(expect.objectContaining({ statusCode: 422, details: { code: 'recipe_key_invalid' } }));
  });
});
