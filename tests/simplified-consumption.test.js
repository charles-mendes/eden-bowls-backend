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

describe('packaging from the market plan product (plan-packaging)', () => {
  const pet = (gramsPerDay) => ({ pet_id: '1', pet_name: 'Luna', quantidade_g_dia: gramsPerDay });

  test('without the object the packaging is the one of before: 300 g and 500 g, 30 days, limit 8', () => {
    expect(buildPackagingRecommendation([pet(100)])).toMatchObject({
      period_days: 30,
      package_sizes_grams: [300, 500],
      suggested_bags_by_size: { 300: 0, 500: 6 }
    });
    expect(buildPackagingRecommendation([pet(100)], { packSizesGrams: [500, 300], planDays: 30, largePackLimit: 8 }))
      .toEqual(buildPackagingRecommendation([pet(100)]));
  });

  test('Operator adds a 1 kg variation: the large pack is 1000 g and every size is listed', () => {
    const options = { packSizesGrams: [300, 500, 1000, 500], planDays: 30, largePackLimit: 8 };

    const packaging = buildPackagingRecommendation([pet(200)], options);
    const simplified = buildSimplifiedRecommendation([pet(200)], MARKETS.BR, options);

    expect(packaging.package_sizes_grams).toEqual([300, 500, 1000]);
    expect(packaging.suggested_bags_by_size).toEqual({ 300: 0, 500: 0, 1000: 6 });
    expect(simplified.pets[0].packs).toMatchObject({ count: 6, pack_size_grams: 1000 });
  });

  test('Lower large-pack limit: 1,500 g a month exceeds 4 small packs, so the pet gets the large pack', () => {
    const options = { packSizesGrams: [300, 500], planDays: 30, largePackLimit: 4 };

    expect(buildSimplifiedRecommendation([pet(50)], MARKETS.BR, options).pets[0].packs).toMatchObject({ count: 3, pack_size_grams: 500 });
    expect(buildSimplifiedRecommendation([pet(50)], MARKETS.BR).pets[0].packs).toMatchObject({ count: 5, pack_size_grams: 300 });
  });

  test('the plan days of the product set the month', () => {
    const simplified = buildSimplifiedRecommendation([pet(100)], MARKETS.BR, { planDays: 28 });

    expect(simplified.period_days).toBe(28);
    expect(simplified.pets[0].monthly.grams).toBe(2800);
    expect(buildPackagingRecommendation([pet(100)], { planDays: 28 }).total_target_grams).toBe(2800);
  });

  test('one size serves every pet', () => {
    const options = { packSizesGrams: [300] };
    expect(buildSimplifiedRecommendation([pet(400)], MARKETS.BR, options).pets[0].packs).toMatchObject({ count: 40, pack_size_grams: 300 });
    expect(buildPackagingRecommendation([pet(400)], options).suggested_bags_by_size).toEqual({ 300: 40 });
  });
});
