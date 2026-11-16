const { parseEnergyKcalPerKg, normalizeRecipeMarket } = require('../core/recipe-content');
const { TtlCache } = require('../infrastructure/cache/ttl-cache');

const LIFE_STAGE_ENERGY_TTL_MS = 60 * 1000;

// Energy density (kcal/kg) that turns daily kcal into grams: the label energyKg of a recipe or, before the
// customer picks one, the mean energyKg of the market's published recipes in the dog's line.
class RecipeEnergyService {
  constructor(options = {}) {
    this.contentRepository = options.contentRepository;
    this.catalogRepository = options.catalogRepository;
    this.cache = options.cache || new TtlCache();
  }

  async forRecipe(market, recipeKey) {
    const key = String(recipeKey || '').trim();
    if (!key) {
      return null;
    }
    const content = await this.contentRepository.findByMarketAndSlug(normalizeRecipeMarket(market) || 'US', key);
    return content && content.label ? parseEnergyKcalPerKg(content.label.energyKg) : null;
  }

  // Published recipes of the market with their line and label energyKg (null when not filled), for the
  // nutrition simulator. A recipe is a product (catalog-products): one with a published variation is listed.
  async listRecipes(market) {
    const normalized = normalizeRecipeMarket(market) || 'US';
    const productIds = [];
    for (const row of await this.catalogRepository.recipeVariationRows()) {
      if (row.market === normalized && row.published && row.productId && !productIds.includes(row.productId)) {
        productIds.push(row.productId);
      }
    }
    const byProduct = new Map((await this.contentRepository.listByMarket(normalized))
      .filter((content) => content.productId)
      .map((content) => [String(content.productId), content]));
    return productIds.filter((productId) => byProduct.has(productId)).map((productId) => {
      const content = byProduct.get(productId);
      return {
        key: content.flavorSlug,
        name: content.name || content.flavorSlug,
        life_stage: content.lifeStage,
        energy_kcal_kg: content.label ? parseEnergyKcalPerKg(content.label.energyKg) : null
      };
    });
  }

  // { puppy, adult, senior } in kcal/kg, a line without a published recipe with energyKg left out.
  async averagesByLifeStage(market) {
    const normalized = normalizeRecipeMarket(market) || 'US';
    const cacheKey = `life-stage-energy:${normalized}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const byLine = {};
    for (const recipe of await this.listRecipes(normalized)) {
      if (recipe.energy_kcal_kg) {
        (byLine[recipe.life_stage] = byLine[recipe.life_stage] || []).push(recipe.energy_kcal_kg);
      }
    }
    const averages = {};
    for (const [lifeStage, values] of Object.entries(byLine)) {
      averages[lifeStage] = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    }
    return this.cache.set(cacheKey, averages, LIFE_STAGE_ENERGY_TTL_MS);
  }

  // A dog without a resolved stage eats from the adult line.
  async forLifeStage(market, lifeStage) {
    const averages = await this.averagesByLifeStage(market);
    return averages[lifeStage || 'adult'] || null;
  }
}

module.exports = {
  RecipeEnergyService
};
