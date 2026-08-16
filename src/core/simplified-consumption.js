const GRAMS_TO_OZ = 0.035274;
const PERIOD_DAYS = 30;
const SMALL_PACK_GRAMS = 300;
const LARGE_PACK_GRAMS = 500;
const LARGE_PACK_THRESHOLD = 8;

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

function selectLocalPackForMonth(monthlyGrams, country) {
  const useLargePack = (Number(monthlyGrams) / SMALL_PACK_GRAMS) > LARGE_PACK_THRESHOLD;
  const sizeGrams = useLargePack ? LARGE_PACK_GRAMS : SMALL_PACK_GRAMS;

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

function buildSimplifiedPet(recommendation, country) {
  const gramsPerDay = Math.max(0, Number.parseInt(recommendation.quantidade_g_dia, 10) || 0);
  const monthlyGrams = gramsPerDay * PERIOD_DAYS;
  const packSelection = selectLocalPackForMonth(monthlyGrams, country);
  const packCount = packSelection.size_grams > 0 ? Math.ceil(monthlyGrams / packSelection.size_grams) : 0;

  return {
    pet_id: String(recommendation.pet_id || ''),
    pet_name: String(recommendation.pet_name || ''),
    daily: formatDailyConsumption(gramsPerDay, country),
    monthly: formatMonthlyConsumption(monthlyGrams, country),
    packs: formatPacksConsumption(packCount, packSelection, country)
  };
}

function buildSimplifiedRecommendation(recommendations, market) {
  const country = resolveCountry(market);
  const items = (Array.isArray(recommendations) ? recommendations : []).map((recommendation) => (
    buildSimplifiedPet(recommendation, country)
  ));

  return {
    country,
    period_days: PERIOD_DAYS,
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

function buildPackagingRecommendation(recommendations) {
  const items = Array.isArray(recommendations) ? recommendations : [];
  const totalGramsPerDay = items.reduce((sum, recommendation) => (
    sum + Math.max(0, Number.parseInt(recommendation.quantidade_g_dia, 10) || 0)
  ), 0);
  const suggested = suggestFrequency(totalGramsPerDay);
  const totalTargetGrams = totalGramsPerDay * PERIOD_DAYS;
  const bags = { 300: 0, 500: 0 };

  for (const recommendation of items) {
    const gramsPerDay = Math.max(0, Number.parseInt(recommendation.quantidade_g_dia, 10) || 0);
    const monthlyGrams = gramsPerDay * PERIOD_DAYS;
    const packSelection = selectLocalPackForMonth(monthlyGrams, 'BR');
    const packCount = packSelection.size_grams > 0 ? Math.ceil(monthlyGrams / packSelection.size_grams) : 0;
    bags[packSelection.size_grams] = (bags[packSelection.size_grams] || 0) + packCount;
  }

  return {
    selected_frequency: 'monthly',
    period_days: PERIOD_DAYS,
    suggested_frequency: suggested.frequency,
    suggested_period_days: suggested.period_days,
    package_sizes_grams: [SMALL_PACK_GRAMS, LARGE_PACK_GRAMS],
    total_grams_per_day: totalGramsPerDay,
    total_target_grams: totalTargetGrams,
    suggested_bags_by_size: bags
  };
}

module.exports = {
  CONSUMPTION_LABELS,
  PERIOD_DAYS,
  buildPackagingRecommendation,
  buildSimplifiedRecommendation,
  consumptionLabels,
  gramsToOz,
  selectLocalPackForMonth
};
