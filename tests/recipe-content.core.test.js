const { labelCompleteness, parseRecipeKey, parseRecipeLabel, parseRecipePresentation } = require('../src/core/recipe-content');

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

describe('parseRecipePresentation', () => {
  function presentation(overrides = {}) {
    return {
      tag: 'Beef',
      title: 'Beef Recipe',
      tagline: 'Strength & Vitality',
      resume: 'Rich in protein and iron, our beef recipe supports strong muscles and lasting energy.',
      highlights: ['Potatoes', 'Beef', 'White Rice', 'Carrots', 'Spinach'],
      colors: { color: '#C97B6C', accentColor: '#EAB8A8', pillBg: '#E8CCBC', pillText: '#5A2010', pillBorder: '#c0907c' },
      ...overrides
    };
  }

  function invalidFields(input) {
    try {
      parseRecipePresentation(input);
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 422, details: { code: 'recipe_presentation_invalid' } });
      return error.details.fields;
    }
    throw new Error('presentation was accepted');
  }

  test('trims text, uppercases colors and ignores unknown keys', () => {
    const parsed = parseRecipePresentation(presentation({ title: '  Beef Recipe  ', tag: ' Beef ', theme: 'dark' }));
    expect(parsed).toEqual({ ...presentation(), colors: { ...presentation().colors, pillBorder: '#C0907C' } });
  });

  test('Invalid color: lists colors.pillBg', () => {
    expect(invalidFields(presentation({ colors: { ...presentation().colors, pillBg: 'red' } }))).toEqual(['colors.pillBg']);
  });

  test.each([
    ['tag', 'x'.repeat(41)],
    ['tag', ''],
    ['title', 'x'.repeat(121)],
    ['tagline', 'x'.repeat(81)],
    ['resume', 'x'.repeat(301)],
    ['title', '   ']
  ])('refuses %s %j', (field, value) => {
    expect(invalidFields(presentation({ [field]: value }))).toEqual([field]);
  });

  test('accepts each text at its limit', () => {
    expect(() => parseRecipePresentation(presentation({
      tag: 'x'.repeat(40), title: 'x'.repeat(120), tagline: 'x'.repeat(80), resume: 'x'.repeat(300), highlights: Array(8).fill('y'.repeat(60))
    }))).not.toThrow();
  });

  test.each([
    [[], ['highlights']],
    [Array(9).fill('Beef'), ['highlights']],
    [['Beef', 'z'.repeat(61), ''], ['highlights[1]', 'highlights[2]']]
  ])('refuses highlights %j', (highlights, fields) => {
    expect(invalidFields(presentation({ highlights }))).toEqual(fields);
  });

  test('a missing presentation lists every field', () => {
    expect(invalidFields(null)).toEqual([
      'tag', 'title', 'tagline', 'resume', 'highlights',
      'colors.color', 'colors.accentColor', 'colors.pillBg', 'colors.pillText', 'colors.pillBorder'
    ]);
  });
});
