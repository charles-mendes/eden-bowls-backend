const { HttpError } = require('../core/http-error');
const { assertRecordMarket, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const {
  MEDIA_ASSET_INVALID,
  RECIPE_CONTENT_IN_USE,
  labelCompleteness,
  normalizeRecipeMarket,
  parseRecipeLabel,
  parseRecipePresentation,
  recipeKeyOf
} = require('../core/recipe-content');

function productNotFound() {
  return new HttpError(404, 'Product not found.', { code: 'product_not_found' });
}

function notFound() {
  return new HttpError(404, 'Recipe not found.', { code: 'recipe_not_found' });
}

function plainKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) ? key : '';
}

function marketOf(market) {
  const normalized = normalizeRecipeMarket(market);
  if (!normalized) {
    throw new HttpError(400, 'Market must be BR or US.', { code: 'invalid_market' });
  }
  return normalized;
}

// Content of a product (recipe-content): image, plan image, label and presentation, shared by every size of the
// product. Name, life stage, aliases and short label change through the product PATCH (admin-catalog). Its banner
// and plan thumbnail are library images (plan-image-library): nothing here deletes an image file.
class RecipeContentService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.catalogRepository = options.catalogRepository;
    this.mediaLibraryService = options.mediaLibraryService || null;
    this.auditService = options.auditService || null;
  }

  // A product's content with the product's variations; a staff session reaches only its markets.
  async resolve(productId, actor = {}) {
    const id = Number(productId);
    const content = Number.isInteger(id) && id > 0 ? await this.repository.findByProductId(id) : null;
    if (!content) {
      throw productNotFound();
    }
    if (shouldEnforceMarketScope(actor)) {
      assertRecordMarket(actor, content.market);
    }
    const variations = await this.catalogRepository.listProductVariations(id);
    return { productId: String(id), market: content.market, key: content.flavorSlug, variations, content };
  }

  // The store's view: the product of the market with the code as sent or, without one, with the code the key's
  // alias resolves to (chicken to turkey). Only a product with an active variation is exposed.
  async resolveLaunched(market, recipeKey) {
    const normalizedMarket = marketOf(market);
    const candidates = [plainKey(recipeKey), recipeKeyOf(recipeKey, normalizedMarket)];
    for (const key of [...new Set(candidates.filter(Boolean))]) {
      const content = await this.repository.findByMarketAndSlug(normalizedMarket, key);
      if (!content || !content.productId) {
        continue;
      }
      const variations = await this.catalogRepository.listProductVariations(content.productId);
      if (!variations.some((variation) => variation.active)) {
        break;
      }
      return { market: normalizedMarket, key, variations, content };
    }
    throw notFound();
  }

  present({ productId, market, key, variations }, content) {
    const label = content ? content.label : null;
    const completeness = labelCompleteness(label, market);
    return {
      productId,
      market,
      flavorSlug: key,
      name: content ? content.name : key,
      lifeStage: content ? content.lifeStage : 'adult',
      flavorAliases: content ? content.flavorAliases || '' : '',
      shortLabel: content ? content.shortLabel || '' : '',
      imageUrl: content ? content.imageUrl : null,
      imageAssetId: content ? content.imageAssetId || null : null,
      imageUpdatedAt: content ? content.imageUpdatedAt : null,
      planImageUrl: content ? content.planImageUrl || null : null,
      planImageAssetId: content ? content.planImageAssetId || null : null,
      planImageUpdatedAt: content ? content.planImageUpdatedAt || null : null,
      label,
      labelUpdatedAt: content ? content.labelUpdatedAt : null,
      labelStatus: completeness.status,
      labelMissing: completeness.missing,
      presentation: content ? content.presentation || null : null,
      presentationUpdatedAt: content ? content.presentationUpdatedAt || null : null,
      variations
    };
  }

  // Store view of the market's launched recipes, by the same rule as getPublic: an active variation.
  async listPublic(market) {
    const normalizedMarket = marketOf(market);
    const recipes = await this.repository.listByMarket(normalizedMarket);
    const byProduct = await this.catalogRepository.listMarketProductVariations(normalizedMarket);
    const items = recipes
      .filter((recipe) => (byProduct.get(String(recipe.productId)) || []).some((variation) => variation.active))
      // The presentation title and short name let the store footer and plan chips name a recipe without one
      // request per recipe.
      .map((recipe) => ({
        key: recipe.flavorSlug,
        name: recipe.name,
        lifeStage: recipe.lifeStage,
        title: recipe.presentation ? recipe.presentation.title : null,
        tag: recipe.presentation ? recipe.presentation.tag || null : null
      }));
    return { market: normalizedMarket, items };
  }

  // Store view of a launched recipe: a flavor with no active variation in the market stays hidden.
  async getPublic(key, market) {
    const recipe = await this.resolveLaunched(market, key);
    const { content } = recipe;
    return {
      key: recipe.key,
      market: recipe.market,
      name: content ? content.name : recipe.key,
      imageUrl: content ? content.imageUrl : null,
      planImageUrl: content ? content.planImageUrl || null : null,
      label: content ? content.label : null,
      presentation: content ? content.presentation || null : null
    };
  }

  // Store banner, as a library image (kind banner): `{ assetId }` of an image already there, or an upload that goes
  // into the library first. The banner linked before stays in the library.
  async uploadImage(productId, payload = {}, actor = {}) {
    const recipe = await this.resolve(productId, actor);
    const asset = await this.resolveLinkedAsset(recipe, 'banner', payload, actor);
    const content = await this.repository.setImage({ productId: recipe.productId, assetId: asset.id, actorId: actorId(actor) });
    await this.recordAudit(actor, 'catalog.recipe.image.update', recipe, { assetId: asset.id });
    return this.present(recipe, content);
  }

  // Package thumbnail of the plan flavor picker, as a library image (plan-image-library): `{ assetId }` of an
  // image already there, or an upload that goes into the library first. Optional: without it the plan shows the
  // banner image. The image linked before stays in the library.
  async uploadPlanImage(productId, payload = {}, actor = {}) {
    const recipe = await this.resolve(productId, actor);
    const asset = await this.resolveLinkedAsset(recipe, 'plan', payload, actor);
    const content = await this.repository.setPlanImage({ productId: recipe.productId, assetId: asset.id, actorId: actorId(actor) });
    await this.recordAudit(actor, 'catalog.recipe.plan_image.update', recipe, { assetId: asset.id });
    return this.present(recipe, content);
  }

  // The library image a link request points at: an existing one by id, or a new upload of that kind. Either way it
  // must be of the kind asked and of the product's market.
  async resolveLinkedAsset(recipe, kind, payload, actor) {
    const hasAssetId = payload.assetId !== undefined && payload.assetId !== null && payload.assetId !== '';
    const hasUpload = payload.imageBase64 !== undefined && payload.imageBase64 !== null && payload.imageBase64 !== '';
    if (hasAssetId === hasUpload) {
      throw new HttpError(422, 'Send either assetId of a library image or a new image.', { code: MEDIA_ASSET_INVALID, reason: 'body' });
    }
    if (!this.mediaLibraryService) {
      throw new HttpError(503, 'Image library is not available.');
    }

    const asset = hasAssetId
      ? await this.mediaLibraryService.get(payload.assetId, actor)
      : (await this.mediaLibraryService.upload({
        kind,
        market: recipe.market,
        originalFilename: payload.originalFilename || `${recipe.key}-${kind}`,
        mimeType: payload.mimeType,
        imageBase64: payload.imageBase64
      }, actor)).asset;
    if (asset.kind !== kind || asset.market !== recipe.market) {
      throw new HttpError(422, `The library image must be a ${kind === 'plan' ? 'plan thumbnail' : 'banner'} of the product market.`, {
        code: MEDIA_ASSET_INVALID,
        reason: asset.kind !== kind ? 'kind' : 'market',
        assetMarket: asset.market,
        assetKind: asset.kind
      });
    }
    return asset;
  }

  // Unlinks the thumbnail only: the library image and its file stay.
  async removePlanImage(productId, actor = {}) {
    const recipe = await this.resolve(productId, actor);
    const previous = recipe.content.planImageAssetId || null;
    if (!previous && !recipe.content.planImageUrl) {
      return this.present(recipe, recipe.content);
    }
    const content = await this.repository.setPlanImage({ productId: recipe.productId, assetId: null, actorId: actorId(actor) });
    await this.recordAudit(actor, 'catalog.recipe.plan_image.delete', recipe, { assetId: previous });
    return this.present(recipe, content);
  }

  async saveLabel(productId, input, actor = {}) {
    const recipe = await this.resolve(productId, actor);
    const label = parseRecipeLabel(input);
    const completeness = labelCompleteness(label, recipe.market);
    const active = recipe.variations.filter((variation) => variation.active);
    if (recipe.market === 'US' && active.length > 0 && completeness.status !== 'complete') {
      throw new HttpError(409, 'The label of a US product with an active variation must stay complete.', {
        code: RECIPE_CONTENT_IN_USE,
        activeVariations: active.map((variation) => variation.id),
        missing: completeness.missing
      });
    }

    const content = await this.repository.setLabel({ productId: recipe.productId, label, actorId: actorId(actor) });
    await this.recordAudit(actor, 'catalog.recipe.label.update', recipe);
    return this.present(recipe, content);
  }

  // Replaces the store presentation whole; an invalid one is refused before anything is stored.
  async savePresentation(productId, input, actor = {}) {
    const recipe = await this.resolve(productId, actor);
    const presentation = parseRecipePresentation(input);
    const content = await this.repository.setPresentation({ productId: recipe.productId, presentation, actorId: actorId(actor) });
    await this.recordAudit(actor, 'catalog.recipe.presentation.update', recipe);
    return this.present(recipe, content);
  }

  async removeImage(productId, actor = {}) {
    const recipe = await this.resolve(productId, actor);
    const active = recipe.variations.filter((variation) => variation.active);
    if (active.length > 0) {
      throw new HttpError(409, 'The image of a product with an active variation cannot be removed.', {
        code: RECIPE_CONTENT_IN_USE,
        activeVariations: active.map((variation) => variation.id)
      });
    }

    // Unlinks the banner only: the library image and its file stay.
    const previous = recipe.content.imageAssetId || null;
    if (!previous && !recipe.content.imageUrl) {
      return this.present(recipe, recipe.content);
    }
    const content = await this.repository.setImage({ productId: recipe.productId, assetId: null, actorId: actorId(actor) });
    await this.recordAudit(actor, 'catalog.recipe.image.delete', recipe, { assetId: previous });
    return this.present(recipe, content);
  }

  async recordAudit(actor, action, recipe, extra = {}) {
    if (!this.auditService || typeof this.auditService.record !== 'function') {
      return;
    }
    await this.auditService.record({
      actor,
      action,
      metadata: { productId: recipe.productId, market: recipe.market, flavorSlug: recipe.key, ...extra }
    });
  }
}

function actorId(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

module.exports = {
  RecipeContentService
};
