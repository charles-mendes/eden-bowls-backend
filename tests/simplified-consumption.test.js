const { MARKETS } = require('../src/core/market');
const {
  buildPackagingRecommendation,
  buildSimplifiedRecommendation,
  selectLocalPackForMonth
} = require('../src/core/simplified-consumption');

describe('simplified consumption', () => {
  test('selects 500 g packs when a month in 300 g packs would exceed 8 units', () => {
    expect(selectLocalPackForMonth(2400, 'BR').size_grams).toBe(300);
    expect(selectLocalPackForMonth(2401, 'BR').size_grams).toBe(500);
    expect(selectLocalPackForMonth(8160, 'US').size_value).toBe(17.6);
  });

  test('formats daily, monthly and packs for Brazil', () => {
    const simplified = buildSimplifiedRecommendation([
      { pet_id: 'pet-1', pet_name: 'Charles', quantidade_g_dia: 272 }
    ], MARKETS.BR);

    expect(simplified.country).toBe('BR');
    expect(simplified.period_days).toBe(30);
    expect(simplified.labels).toEqual({ daily: 'Diário', monthly: 'Mensal', packs: 'Packs' });
    expect(simplified.pets[0]).toMatchObject({
      pet_id: 'pet-1',
      pet_name: 'Charles',
      daily: { value: 272, unit: 'g/dia', grams: 272, formatted: '272 g/dia' },
      monthly: { value: 8.16, unit: 'kg/mês', grams: 8160, formatted: '8,16 kg/mês' },
      packs: {
        count: 17,
        pack_size_grams: 500,
        pack_size_value: 500,
        pack_size_unit: 'g',
        formatted: '17 packs de 500 g/mês'
      }
    });
  });

  test('formats daily, monthly and packs for the United States', () => {
    const simplified = buildSimplifiedRecommendation([
      { pet_id: 'pet-1', pet_name: 'Charles', quantidade_g_dia: 272 }
    ], MARKETS.US);

    expect(simplified.pets[0].daily).toMatchObject({
      value: 9.6,
      unit: 'oz/day',
      grams: 272,
      formatted: '9.6 oz/day'
    });
    expect(simplified.pets[0].monthly).toMatchObject({
      unit: 'oz/month',
      grams: 8160,
      formatted: '287.8 oz/month'
    });
    expect(simplified.pets[0].packs).toMatchObject({
      count: 17,
      pack_size_grams: 500,
      pack_size_value: 17.6,
      pack_size_unit: 'oz',
      formatted: '17 × 17.6 oz/month'
    });
  });

  test('suggests weekly packaging when daily grams are high', () => {
    const packaging = buildPackagingRecommendation([
      { quantidade_g_dia: 500 },
      { quantidade_g_dia: 450 }
    ]);

    expect(packaging.selected_frequency).toBe('monthly');
    expect(packaging.period_days).toBe(30);
    expect(packaging.suggested_frequency).toBe('weekly');
    expect(packaging.total_grams_per_day).toBe(950);
    expect(packaging.total_target_grams).toBe(28500);
  });
});
