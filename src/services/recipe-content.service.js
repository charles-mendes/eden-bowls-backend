const { HttpError } = require('../core/http-error');
const { assertRecordMarket, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const {
  RECIPE_CONTENT_IN_USE,
  RECIPE_IMAGE_INVALID,
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
const { processRecipeImage } = require('../infrastructure/imaging/recipe-image');

function decodeImageBase64(imageBase64) {
  const raw = String(imageBase64 || '');
  const buffer = raw && !/data:|,/.test(raw) ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (!buffer.length) {
    throw new HttpError(422, 'Invalid image data.', { code: RECIPE_IMAGE_INVALID, reason: 'data' });
  }
  return buffer;
}

// Content of a product (recipe-content): image, plan image, label and presentation, shared by every size of the
// product. Name, life stage, aliases and short label change through the product PATCH (admin-catalog).
class RecipeContentService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.catalogRepository = options.catalogRepository;
    this.imageStorage = options.imageStorage || null;
    this.processImage = options.processImage || processRecipeImage;
    this.auditService = options.auditService || null;
    this.logger = options.logger || null;
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
      imageUpdatedAt: content ? content.imageUpdatedAt : null,
      planImageUrl: content ? content.planImageUrl || null : null,
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

  async uploadImage(productId, payload = {}, actor = {}) {
    if (!this.imageStorage || typeof this.imageStorage.write !== 'function') {
      throw new HttpError(503, 'Recipe image storage is not available.');
    }
    const recipe = await this.resolve(productId, actor);
    const processed = await this.processImage({
      mimeType: payload.mimeType,
      buffer: decodeImageBase64(payload.imageBase64)
    });

    const previous = recipe.content;
    const imageUrl = await this.imageStorage.write({ market: recipe.market, flavorSlug: recipe.key, buffer: processed.buffer });
    let content;
    try {
      content = await this.repository.setImage({ productId: recipe.productId, imageUrl, actorId: actorId(actor) });
    } catch (error) {
      await this.deleteFile(imageUrl);
      throw error;
    }
    // The old file goes only after the new row points elsewhere, so the store never links to a missing file.
    if (previous && previous.imageUrl && previous.imageUrl !== imageUrl) {
      await this.deleteFile(previous.imageUrl);
    }

    await this.recordAudit(actor, 'catalog.recipe.image.update', recipe);
    return this.present(recipe, content);
  }

  // Package thumbnail of the plan flavor picker. Optional: without it the plan shows the banner image.
  async uploadPlanImage(productId, payload = {}, actor = {}) {
    if (!this.imageStorage || typeof this.imageStorage.write !== 'function') {
      throw new HttpError(503, 'Recipe image storage is not available.');
    }
    const recipe = await this.resolve(productId, actor);
    const processed = await this.processImage({
      mimeType: payload.mimeType,
      buffer: decodeImageBase64(payload.imageBase64),
      kind: 'plan'
    });

    const previous = recipe.content.planImageUrl;
    const imageUrl = await this.imageStorage.write({ market: recipe.market, flavorSlug: `${recipe.key}-plan`, buffer: processed.buffer });
    let content;
    try {
      content = await this.repository.setPlanImage({ productId: recipe.productId, imageUrl, actorId: actorId(actor) });
    } catch (error) {
      await this.deleteFile(imageUrl);
      throw error;
    }
    if (previous && previous !== imageUrl) {
      await this.deleteFile(previous);
    }

    await this.recordAudit(actor, 'catalog.recipe.plan_image.update', recipe);
    return this.present(recipe, content);
  }

  async removePlanImage(productId, actor = {}) {
    const recipe = await this.resolve(productId, actor);
    const previous = recipe.content.planImageUrl;
    if (!previous) {
      return this.present(recipe, recipe.content);
    }
    const content = await this.repository.setPlanImage({ productId: recipe.productId, imageUrl: null, actorId: actorId(actor) });
    await this.deleteFile(previous);
    await this.recordAudit(actor, 'catalog.recipe.plan_image.delete', recipe);
    return this.present(recipe, content);
  }

  // Saves a label as sent, complete or not. A US flavor with an active variation must keep a complete label.
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

    const previous = recipe.content;
    if (!previous.imageUrl) {
      return this.present(recipe, previous);
    }
    const content = await this.repository.setImage({ productId: recipe.productId, imageUrl: null, actorId: actorId(actor) });
    await this.deleteFile(previous.imageUrl);
    await this.recordAudit(actor, 'catalog.recipe.image.delete', recipe);
    return this.present(recipe, content);
  }

  async deleteFile(imageUrl) {
    if (!this.imageStorage || typeof this.imageStorage.delete !== 'function') {
      return;
    }
    try {
      await this.imageStorage.delete(imageUrl);
    } catch (error) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error({ err: error && error.message }, 'Failed to delete recipe image file.');
      }
    }
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
