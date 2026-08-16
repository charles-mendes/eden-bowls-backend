const KG_TO_LB = 2.2046226218;

const MARKETS = {
  US: {
    country: 'US',
    currency: 'USD',
    locale: 'en-US',
    domain: 'com',
    weightUnit: 'lb',
    labels: {
      daily: 'Per day',
      monthly: 'Per month',
      packs: 'Packs'
    },
    flavorLabels: {
      beef: 'Beef',
      fish: 'Fish',
      pork: 'Pork',
      turkey: 'Turkey'
    }
  },
  BR: {
    country: 'BR',
    currency: 'BRL',
    locale: 'pt-BR',
    domain: 'com.br',
    weightUnit: 'kg',
    labels: {
      daily: 'Por dia',
      monthly: 'Por mês',
      packs: 'Pacotes'
    },
    flavorLabels: {
      beef: 'Bovino',
      fish: 'Peixe',
      pork: 'Porco',
      turkey: 'Peru'
    }
  }
};

function normalizeCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  return country === 'US' || country === 'BR' ? country : '';
}

function normalizeDomain(value) {
  const domain = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '');

  if (domain === 'com.br' || domain === 'combr') {
    return 'com.br';
  }

  if (domain === 'com') {
    return 'com';
  }

  return '';
}

function normalizeWeightUnit(value) {
  return value === 'lb' ? 'lb' : 'kg';
}

function roundWeight(value) {
  return Math.round(Number(value) * 100) / 100;
}

function convertWeight(value, fromUnit, toUnit) {
  const amount = Number(value);
  const sourceUnit = normalizeWeightUnit(fromUnit);
  const targetUnit = normalizeWeightUnit(toUnit);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  if (sourceUnit === targetUnit) {
    return roundWeight(amount);
  }

  if (sourceUnit === 'kg' && targetUnit === 'lb') {
    return roundWeight(amount * KG_TO_LB);
  }

  return roundWeight(amount / KG_TO_LB);
}

function resolveMarket({ country, domain } = {}) {
  const normalizedDomain = normalizeDomain(domain);
  if (normalizedDomain === 'com.br') {
    return MARKETS.BR;
  }

  if (normalizedDomain === 'com') {
    return MARKETS.US;
  }

  const normalizedCountry = normalizeCountry(country);
  if (normalizedCountry) {
    return MARKETS[normalizedCountry];
  }

  return MARKETS.US;
}

function formatMass(grams, market = MARKETS.US) {
  const amount = Number(grams);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `${new Intl.NumberFormat(market.locale).format(safeAmount)} g`;
}

function formatPacks(count, market = MARKETS.US) {
  const amount = Number(count);
  const safeCount = Number.isFinite(amount) ? amount : 0;

  if (market.country === 'BR') {
    return safeCount === 1 ? '1 pacote' : `${safeCount} pacotes`;
  }

  return safeCount === 1 ? '1 pack' : `${safeCount} packs`;
}

function formatPetForMarket(pet, market = MARKETS.US) {
  if (!pet) {
    return pet;
  }

  const converted = convertWeight(pet.weight_input ?? pet.weight ?? 0, pet.weight_unit, market.weightUnit);

  return {
    ...pet,
    weight_input: converted,
    weight: converted,
    weight_unit: market.weightUnit
  };
}

function applyMarketWeightDefaults(payload = {}, market = MARKETS.US) {
  const weightUnit = payload.weight_unit || market.weightUnit;
  const converted = convertWeight(payload.weight ?? payload.weight_input ?? 0, weightUnit, market.weightUnit);

  return {
    ...payload,
    weight: converted,
    weight_unit: market.weightUnit
  };
}

module.exports = {
  MARKETS,
  KG_TO_LB,
  normalizeCountry,
  normalizeDomain,
  normalizeWeightUnit,
  convertWeight,
  resolveMarket,
  formatMass,
  formatPacks,
  formatPetForMarket,
  applyMarketWeightDefaults
};
