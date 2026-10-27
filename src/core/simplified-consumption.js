const GRAMS_TO_OZ = 0.035274;
// Packaging of before the catalog fed it, and the fallback without an active variation (plan-packaging).
const PERIOD_DAYS = 30;
const SMALL_PACK_GRAMS = 300;
const LARGE_PACK_GRAMS = 500;
const LARGE_PACK_THRESHOLD = 8;
const MAX_LARGE_PACK_LIMIT = 60;

const CONSUMPTION_LABELS = {
  US: {
    daily: 'Daily',
    monthly: 'Monthly',
    packs: 'Packs'
  },
  BR: {
    daily: 'Diário',
    monthly: 'Mensal',
    packs: 'Packs'
  }
};

function gramsToOz(grams) {
  return Number((Number(grams || 0) * GRAMS_TO_OZ).toFixed(1));
}

function resolveCountry(market) {
  return market && market.country === 'BR' ? 'BR' : 'US';
}

function consumptionLabels(market) {
  return CONSUMPTION_LABELS[resolveCountry(market)];
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

// { packSizesGrams, planDays, largePackLimit } of the market's plan product, each falling back on its own:
// pack sizes sorted and distinct (the lightest is the small pack, the heaviest the large one).
function packagingOf(options = {}) {
  const sizes = [...new Set((Array.isArray(options.packSizesGrams) ? options.packSizesGrams : [])
    .map(positiveInteger)
    .filter(Boolean))].sort((left, right) => left - right);
  const packSizesGrams = sizes.length ? sizes : [SMALL_PACK_GRAMS, LARGE_PACK_GRAMS];
  const limit = positiveInteger(options.largePackLimit);
  return {
    packSizesGrams,
    smallPackGrams: packSizesGrams[0],
    largePackGrams: packSizesGrams[packSizesGrams.length - 1],
    planDays: positiveInteger(options.planDays) || PERIOD_DAYS,
    largePackLimit: limit && limit <= MAX_LARGE_PACK_LIMIT ? limit : LARGE_PACK_THRESHOLD
  };
}

function selectLocalPackForMonth(monthlyGrams, country, options = {}) {
  const packaging = packagingOf(options);
  const useLargePack = (Number(monthlyGrams) / packaging.smallPackGrams) > packaging.largePackLimit;
  const sizeGrams = useLargePack ? packaging.largePackGrams : packaging.smallPackGrams;

  if (country === 'BR') {
    return {
      size_grams: sizeGrams,
      size_label: `${sizeGrams} g`,
      size_value: sizeGrams,
      size_unit: 'g'
    };
  }

  const sizeOz = gramsToOz(sizeGrams);
  return {
    size_grams: sizeGrams,
    size_label: `${sizeOz.toFixed(1)} oz`,
    size_value: sizeOz,
    size_unit: 'oz'
  };
}

function formatDailyConsumption(gramsPerDay, country) {
  if (country === 'BR') {
    return {
      value: gramsPerDay,
      unit: 'g/dia',
      grams: gramsPerDay,
      formatted: `${gramsPerDay} g/dia`
    };
  }

  const ozValue = gramsToOz(gramsPerDay);
  return {
    value: ozValue,
    unit: 'oz/day',
    grams: gramsPerDay,
    formatted: `${ozValue.toFixed(1)} oz/day`
  };
}

function formatMonthlyConsumption(monthlyGrams, country) {
  if (country === 'BR') {
    const kgValue = Number((monthlyGrams / 1000).toFixed(2));
    return {
      value: kgValue,
      unit: 'kg/mês',
      grams: monthlyGrams,
      formatted: `${kgValue.toFixed(2).replace('.', ',')} kg/mês`
    };
  }

  const ozValue = gramsToOz(monthlyGrams);
  return {
    value: ozValue,
    unit: 'oz/month',
    grams: monthlyGrams,
    formatted: `${ozValue.toFixed(1)} oz/month`
  };
}

function formatPacksConsumption(packCount, packSelection, country) {
  const sizeGrams = Math.max(0, Number(packSelection.size_grams || 0));
  const sizeValue = Number(packSelection.size_value || 0);
  const sizeUnit = String(packSelection.size_unit || 'g');

  if (country === 'BR') {
    return {
      count: packCount,
      pack_size_grams: sizeGrams,
      pack_size_value: sizeValue,
      pack_size_unit: sizeUnit,
      formatted: `${packCount} packs de ${sizeGrams} g/mês`
    };
  }

  return {
    count: packCount,
    pack_size_grams: sizeGrams,
    pack_size_value: sizeValue,
    pack_size_unit: sizeUnit,
    formatted: `${packCount} × ${Number(sizeValue).toFixed(1)} oz/month`
  };
}

function buildSimplifiedPet(recommendation, country, packaging) {
  const gramsPerDay = Math.max(0, Number.parseInt(recommendation.quantidade_g_dia, 10) || 0);
  const monthlyGrams = gramsPerDay * packaging.planDays;
  const packSelection = selectLocalPackForMonth(monthlyGrams, country, packaging);
  const packCount = packSelection.size_grams > 0 ? Math.ceil(monthlyGrams / packSelection.size_grams) : 0;

  return {
    pet_id: String(recommendation.pet_id || ''),
    pet_name: String(recommendation.pet_name || ''),
    daily: formatDailyConsumption(gramsPerDay, country),
    monthly: formatMonthlyConsumption(monthlyGrams, country),
    packs: formatPacksConsumption(packCount, packSelection, country)
  };
}

function buildSimplifiedRecommendation(recommendations, market, options = {}) {
  const country = resolveCountry(market);
  const packaging = packagingOf(options);
  const items = (Array.isArray(recommendations) ? recommendations : []).map((recommendation) => (
    buildSimplifiedPet(recommendation, country, packaging)
  ));

  return {
    country,
    period_days: packaging.planDays,
    labels: consumptionLabels(market),
    pets: items
  };
}

function suggestFrequency(totalGramsPerDay) {
  if (totalGramsPerDay >= 900) {
    return { frequency: 'weekly', period_days: 7 };
  }

  if (totalGramsPerDay <= 250) {
    return { frequency: 'monthly', period_days: 30 };
  }

  return { frequency: 'biweekly', period_days: 14 };
}

function buildPackagingRecommendation(recommendations, options = {}) {
  const packaging = packagingOf(options);
  const items = Array.isArray(recommendations) ? recommendations : [];
  const totalGramsPerDay = items.reduce((sum, recommendation) => (
    sum + Math.max(0, Number.parseInt(recommendation.quantidade_g_dia, 10) || 0)
  ), 0);
  const suggested = suggestFrequency(totalGramsPerDay);
  const totalTargetGrams = totalGramsPerDay * packaging.planDays;
  const bags = Object.fromEntries(packaging.packSizesGrams.map((size) => [size, 0]));

  for (const recommendation of items) {
    const gramsPerDay = Math.max(0, Number.parseInt(recommendation.quantidade_g_dia, 10) || 0);
    const monthlyGrams = gramsPerDay * packaging.planDays;
    const packSelection = selectLocalPackForMonth(monthlyGrams, 'BR', packaging);
    const packCount = packSelection.size_grams > 0 ? Math.ceil(monthlyGrams / packSelection.size_grams) : 0;
    bags[packSelection.size_grams] = (bags[packSelection.size_grams] || 0) + packCount;
  }

  return {
    selected_frequency: 'monthly',
    period_days: packaging.planDays,
    suggested_frequency: suggested.frequency,
    suggested_period_days: suggested.period_days,
    package_sizes_grams: [...packaging.packSizesGrams],
    total_grams_per_day: totalGramsPerDay,
    total_target_grams: totalTargetGrams,
    suggested_bags_by_size: bags
  };
}

module.exports = {
  CONSUMPTION_LABELS,
  LARGE_PACK_THRESHOLD,
  MAX_LARGE_PACK_LIMIT,
  PERIOD_DAYS,
  packagingOf,
  buildPackagingRecommendation,
  buildSimplifiedRecommendation,
  consumptionLabels,
  gramsToOz,
  selectLocalPackForMonth
};
