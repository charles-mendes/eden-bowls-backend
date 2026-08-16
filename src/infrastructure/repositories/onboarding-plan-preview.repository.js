const { resolveMarket } = require('../../core/market');
const { normalizeDraftPets, petHasNutritionalProfile } = require('../../core/onboarding-draft-pets');
const {
  ANONYMOUS_PACK_SIZE_GRAMS,
  buildCatalogPricingSnapshot,
  flattenProductCatalog,
  listFallbackCatalogItems,
  sanitizeFlavorSlug,
  throwPlanError,
  uniqueSanitizeFlavors
} = require('../../core/plan-catalog-pricing');

class OnboardingPlanPreviewRepository {
  constructor(options = {}) {
    this.recommendationRepository = options.recommendationRepository || null;
    this.productsRepository = options.productsRepository || null;
  }

  async previewPlan(userId, payload = {}, marketInput) {
    const market = marketInput && marketInput.country ? marketInput : resolveMarket(marketInput);
    const draftPets = normalizeDraftPets(payload.pets).filter(petHasNutritionalProfile);
    const recommendation = this.recommendationRepository
      ? await this.recommendationRepository.getRecommendation(
        userId,
        market,
        draftPets.length > 0 ? draftPets : undefined
      )
      : null;
    const simplifiedPets = recommendation && recommendation.simplified && Array.isArray(recommendation.simplified.pets)
      ? recommendation.simplified.pets
      : [];
    const canMatchRecommendation = Boolean(userId) || simplifiedPets.length > 0;

    const catalogLineRequests = [];
    const flavorsByPet = [];
    const selectedPets = [];

    for (const petInput of Array.isArray(payload.pets) ? payload.pets : []) {
      if (!petInput || typeof petInput !== 'object' || petInput.enabled === false) {
        continue;
      }

      const matchedPet = canMatchRecommendation
        ? this.matchRecommendedPet(petInput, simplifiedPets)
        : {
          pet_id: String(petInput.pet_id || ''),
          pet_name: String(petInput.pet_name || ''),
          packs: { pack_size_grams: ANONYMOUS_PACK_SIZE_GRAMS }
        };

      const packSizeGrams = Number(matchedPet.packs && matchedPet.packs.pack_size_grams);
      if (canMatchRecommendation && (!Number.isFinite(packSizeGrams) || packSizeGrams <= 0)) {
        throwPlanError(422, 'plan_selection_snapshot_mismatch', 'Plan selection does not match the current recommendation.', {
          pets: 'pack size recomendado ausente'
        });
      }

      const flavorQuantities = this.buildFlavorQuantities(petInput);
      const targetPackSizeGrams = canMatchRecommendation ? packSizeGrams : ANONYMOUS_PACK_SIZE_GRAMS;
      const petId = String(matchedPet.pet_id || petInput.pet_id || '');
      const petName = String(matchedPet.pet_name || petInput.pet_name || '');

      selectedPets.push({
        pet_id: petId,
        pet_name: petName,
        enabled: true,
        selected_flavors: [...flavorQuantities.keys()],
        pack_size_grams: targetPackSizeGrams
      });
      flavorsByPet.push({
        pet_id: petId,
        pet_name: petName,
        flavors: Object.fromEntries(flavorQuantities)
      });

      for (const [flavor, quantity] of flavorQuantities) {
        catalogLineRequests.push({
          pet_id: petId,
          pet_name: petName,
          flavor,
          quantity,
          target_pack_size_grams: targetPackSizeGrams
        });
      }
    }

    if (catalogLineRequests.length === 0) {
      throwPlanError(422, 'plan_selection_snapshot_mismatch', 'Plan selection does not match the current recommendation.', {
        pets: 'nenhum pet enabled com pesos validos'
      });
    }

    const catalogPricing = buildCatalogPricingSnapshot(
      catalogLineRequests,
      await this.loadCatalogItems(market),
      market
    );

    return {
      subscription_term_months: payload.subscription_term_months,
      catalog_pricing: catalogPricing,
      flavors_by_pet: flavorsByPet,
      pets: selectedPets,
      country: market.country,
      currency: market.currency,
      validated_with: {
        recommendation_version: recommendation && recommendation.version ? recommendation.version : null,
        validated_at: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    };
  }

  matchRecommendedPet(petInput, simplifiedPets) {
    const petId = String(petInput.pet_id || '');
    const petName = String(petInput.pet_name || '').trim().toLowerCase();
    const byId = petId
      ? simplifiedPets.find((pet) => String(pet.pet_id || '') === petId)
      : null;
    const matched = byId || simplifiedPets.find((pet) => String(pet.pet_name || '').trim().toLowerCase() === petName);

    if (!matched) {
      throwPlanError(422, 'plan_selection_snapshot_mismatch', 'Plan selection does not match the current recommendation.', {
        pets: 'pet nao encontrado na recommendation atual'
      });
    }

    return matched;
  }

  buildFlavorQuantities(petInput) {
    const flavors = uniqueSanitizeFlavors(petInput.selected_flavors);
    const weights = Array.isArray(petInput.flavor_weights) ? petInput.flavor_weights : [];

    if (flavors.length === 0 || flavors.length !== weights.length) {
      throwPlanError(422, 'plan_selection_snapshot_mismatch', 'Plan selection does not match the current recommendation.', {
        pets: 'distribuicao de sabores inconsistente'
      });
    }

    const quantities = new Map();

    for (let index = 0; index < flavors.length; index += 1) {
      const weight = Number(weights[index]);
      if (!Number.isFinite(weight) || weight <= 0) {
        continue;
      }

      const flavor = sanitizeFlavorSlug(flavors[index]);
      const quantity = Math.round(weight);
      if (!flavor || quantity <= 0) {
        continue;
      }

      quantities.set(flavor, (quantities.get(flavor) || 0) + quantity);
    }

    if (quantities.size === 0) {
      throwPlanError(422, 'plan_selection_snapshot_mismatch', 'Plan selection does not match the current recommendation.', {
        pets: 'pet enabled sem sabor com peso positivo'
      });
    }

    return quantities;
  }

  async loadCatalogItems(market) {
    if (!this.productsRepository) {
      return listFallbackCatalogItems(market.country);
    }

    try {
      const catalog = await this.productsRepository.listByCategory({
        categorySlug: 'flavors',
        country: market.country,
        currency: market.currency
      });
      const items = flattenProductCatalog(catalog);
      if (items.length > 0) {
        return items;
      }
    } catch (error) {
      const code = error && error.details && error.details.code;
      if (code !== 'catalog_not_initialized' && Number(error && error.statusCode) !== 503) {
        throwPlanError(422, 'catalog_pricing_unavailable', 'Catalog pricing is unavailable.');
      }
    }

    return listFallbackCatalogItems(market.country);
  }
}

module.exports = {
  OnboardingPlanPreviewRepository
};
