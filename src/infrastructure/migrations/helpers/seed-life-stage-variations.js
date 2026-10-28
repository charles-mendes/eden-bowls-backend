const { FLAVOR_CATALOG, FLAVOR_SLUG_META, FLAVOR_ALIASES_META, LIFE_STAGE_META, SEED_FLAVOR_ALIASES } = require('../../../core/flavors');
const { MARKETS } = require('../../../core/market');
const { RECIPE_KEY_META } = require('../../../core/recipe-content');

// The four puppy and senior recipes of add-life-stage-recipes (task 1.8), in both markets: prices D-05 per pack
// (same numbers in BRL and USD) and the approved short names. Full names come from MARKETS.flavorLabels.
const LIFE_STAGE_RECIPES = [
  {
    key: 'puppy-chicken-pork',
    lifeStage: 'puppy',
    prices: [30, 35],
    shortLabel: { BR: 'Frango e Porco · Filhote', US: 'Chicken & Pork · Puppy' }
  },
  {
    key: 'puppy-beef-chicken',
    lifeStage: 'puppy',
    prices: [35, 40],
    shortLabel: { BR: 'Bovino e Frango · Filhote', US: 'Beef & Chicken · Puppy' }
  },
  {
    key: 'senior-beef',
    lifeStage: 'senior',
    prices: [40, 45],
    shortLabel: { BR: 'Bovino · Sênior', US: 'Beef · Senior' }
  },
  {
    key: 'senior-chicken',
    lifeStage: 'senior',
    prices: [40, 45],
    shortLabel: { BR: 'Frango · Sênior', US: 'Chicken · Senior' }
  }
];

const SEED_MARKETS = ['BR', 'US'];
const SHORT_LABEL_META = '_short_label';
const SEEDED_BY_META = '_seeded_by';

function normalizeWeight(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

// The pack weights of a market, small then large, as the adult catalog stores them (300g/500g, 10.6oz/17.6oz).
function packWeights(market) {
  return FLAVOR_CATALOG[market].packs.map((pack) => pack.weight);
}

function skuFor(market, key, weight) {
  return `${key}-${market}-${normalizeWeight(weight).replace(/\./g, '_')}`.toUpperCase();
}

/**
 * Variations to create in one market, given the variations its plan product already has for these recipes
 * ({ recipeKey, weight }). A recipe whose existing variation has no weight was created by hand with an unknown
 * pack size: it is left to the operator, so the seed never duplicates a pack.
 */
function planLifeStageVariations(market, existing = []) {
  const create = [];
  const skipped = [];

  for (const recipe of LIFE_STAGE_RECIPES) {
    const current = existing.filter((item) => item.recipeKey === recipe.key);
    if (current.some((item) => !normalizeWeight(item.weight))) {
      skipped.push({ market, key: recipe.key, reason: 'existing variation without weight' });
      continue;
    }
    const weights = new Set(current.map((item) => normalizeWeight(item.weight)));
    packWeights(market).forEach((weight, index) => {
      if (weights.has(normalizeWeight(weight))) {
        return;
      }
      const name = MARKETS[market].flavorLabels[recipe.key];
      create.push({
        market,
        key: recipe.key,
        lifeStage: recipe.lifeStage,
        weight,
        price: recipe.prices[index],
        name,
        title: `${name} ${weight}`,
        sku: skuFor(market, recipe.key, weight),
        shortLabel: recipe.shortLabel[market],
        aliases: (SEED_FLAVOR_ALIASES[recipe.key] || []).join(','),
        zoneId: FLAVOR_CATALOG[market].zoneId
      });
    });
  }

  return { create, skipped };
}

// Meta rows of a seeded variation, the same keys the admin writes when it creates one, plus the weight the
// plan needs to price the pack and a marker that lets down() remove only what this seed created.
function variationMeta(variation, seededBy) {
  const price = Number(variation.price).toFixed(2);
  return [
    ['_sku', variation.sku],
    ['attribute_pa_flavor', variation.name],
    ['attribute_pa_weight', variation.weight],
    [FLAVOR_SLUG_META, variation.key],
    [FLAVOR_ALIASES_META, variation.aliases],
    [LIFE_STAGE_META, variation.lifeStage],
    [SHORT_LABEL_META, variation.shortLabel],
    [RECIPE_KEY_META, variation.key],
    ['_regular_price', price],
    ['_price', price],
    [`_${variation.zoneId}_regular_price`, price],
    ['_stripe_price_fingerprint', ''],
    [SEEDED_BY_META, seededBy]
  ];
}

module.exports = {
  LIFE_STAGE_RECIPES,
  SEEDED_BY_META,
  SEED_MARKETS,
  packWeights,
  planLifeStageVariations,
  variationMeta
};
