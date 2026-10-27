const { HttpError } = require('../core/http-error');
const {
  RECIPE_CONTENT_IN_USE,
  RECIPE_IMAGE_INVALID,
  labelCompleteness,
  RECIPE_KEY_INVALID,
  normalizeRecipeMarket,
  parseRecipeKey,
  parseRecipeLabel,
  recipeKeyOf
} = require('../core/recipe-content');
const { LIFE_STAGES } = require('../core/flavors');

const MAX_RECIPE_NAME_LENGTH = 120;

function parseRecipeName(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name || name.length > MAX_RECIPE_NAME_LENGTH) {
    throw new HttpError(422, `Recipe name must have 1 to ${MAX_RECIPE_NAME_LENGTH} characters.`, { code: 'recipe_name_invalid' });
  }
  return name;
}

function parseRecipeLifeStage(value) {
  const lifeStage = String(value == null ? '' : value).trim().toLowerCase();
  if (!LIFE_STAGES.includes(lifeStage)) {
    throw new HttpError(422, `Recipe life stage must be one of ${LIFE_STAGES.join(', ')}.`, { code: 'recipe_life_stage_invalid' });
  }
  return lifeStage;
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

// Image and label of a recipe per market and flavor (recipe-content), shared by every size of that flavor.
class RecipeContentService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.catalogRepository = options.catalogRepository;
    this.imageStorage = options.imageStorage || null;
    this.processImage = options.processImage || processRecipeImage;
    this.auditService = options.auditService || null;
    this.logger = options.logger || null;
  }

  // A registered recipe of the market, by its key as sent, with the variations that use it.
  async resolve(market, recipeKey) {
    const normalizedMarket = marketOf(market);
    const key = plainKey(recipeKey);
    const content = key ? await this.repository.findByMarketAndSlug(normalizedMarket, key) : null;
    if (!content) {
      throw notFound();
    }
    const variations = await this.catalogRepository.listRecipeVariations(normalizedMarket, key);
    return { market: normalizedMarket, key, variations, content };
  }

  // The store's view: the key as sent or, with no variation using it, the key its alias resolves to
  // (chicken to turkey). Only a recipe with an active variation in the market is exposed.
  async resolveLaunched(market, recipeKey) {
    const normalizedMarket = marketOf(market);
    const candidates = [plainKey(recipeKey), recipeKeyOf(recipeKey, normalizedMarket)];
    for (const key of [...new Set(candidates.filter(Boolean))]) {
      const variations = await this.catalogRepository.listRecipeVariations(normalizedMarket, key);
      if (variations.length > 0) {
        if (!variations.some((variation) => variation.active)) {
          break;
        }
        return { market: normalizedMarket, key, variations };
      }
    }
    throw notFound();
  }

  // Every registered recipe of the market with its variations and content state, for the admin.
  async list(market) {
    const normalizedMarket = marketOf(market);
    const recipes = await this.repository.listByMarket(normalizedMarket);
    const byKey = await this.catalogRepository.listMarketRecipeVariations(normalizedMarket);
    const items = recipes.map((recipe) => ({
      key: recipe.flavorSlug,
      name: recipe.name,
      lifeStage: recipe.lifeStage,
      imageUrl: recipe.imageUrl,
      labelStatus: labelCompleteness(recipe.label, normalizedMarket).status,
      variations: byKey.get(recipe.flavorSlug) || []
    }));
    return { market: normalizedMarket, items };
  }

  async create(market, input = {}, actor = {}) {
    const normalizedMarket = marketOf(market);
    const key = parseRecipeKey(input.key);
    if (!key) {
      throw new HttpError(422, 'Recipe key is required.', { code: RECIPE_KEY_INVALID });
    }
    const name = parseRecipeName(input.name);
    const lifeStage = input.lifeStage == null ? 'adult' : parseRecipeLifeStage(input.lifeStage);
    if (await this.repository.findByMarketAndSlug(normalizedMarket, key)) {
      throw new HttpError(409, 'A recipe with this key already exists in the market.', { code: 'recipe_key_taken' });
    }
    let content;
    try {
      content = await this.repository.createRecipe({ market: normalizedMarket, flavorSlug: key, name, lifeStage, actorId: actorId(actor) });
    } catch (error) {
      if (error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)) {
        throw new HttpError(409, 'A recipe with this key already exists in the market.', { code: 'recipe_key_taken' });
      }
      throw error;
    }
    const recipe = { market: normalizedMarket, key, variations: await this.catalogRepository.listRecipeVariations(normalizedMarket, key) };
    await this.recordAudit(actor, 'catalog.recipe.create', recipe, { name, lifeStage });
    return this.present(recipe, content);
  }

  // Renames the recipe and/or changes its life stage; every variation of the recipe follows the new stage.
  async update(market, recipeKey, input = {}, actor = {}) {
    const recipe = await this.resolve(market, recipeKey);
    const name = input.name === undefined ? undefined : parseRecipeName(input.name);
    const lifeStage = input.lifeStage === undefined ? undefined : parseRecipeLifeStage(input.lifeStage);
    if (name === undefined && lifeStage === undefined) {
      throw new HttpError(422, 'Send the recipe name or life stage.', { code: 'recipe_update_empty' });
    }
    const content = await this.repository.updateRecipe({ market: recipe.market, flavorSlug: recipe.key, name, lifeStage, actorId: actorId(actor) });
    if (name !== undefined && name !== recipe.content.name) {
      await this.recordAudit(actor, 'catalog.recipe.rename', recipe, { from: recipe.content.name, to: name });
    }
    if (lifeStage !== undefined && lifeStage !== recipe.content.lifeStage) {
      await this.catalogRepository.setRecipeLifeStage(recipe.market, recipe.key, lifeStage);
      await this.recordAudit(actor, 'catalog.recipe.life_stage', recipe, { from: recipe.content.lifeStage, to: lifeStage });
    }
    return this.present(recipe, content);
  }

  async remove(market, recipeKey, actor = {}) {
    const recipe = await this.resolve(market, recipeKey);
    if (recipe.variations.length > 0) {
      throw new HttpError(409, 'A recipe used by variations cannot be deleted.', {
        code: 'recipe_in_use',
        variations: recipe.variations.map((variation) => ({ id: variation.id, sku: variation.sku, name: variation.name }))
      });
    }
    await this.repository.deleteRecipe({ market: recipe.market, flavorSlug: recipe.key });
    if (recipe.content.imageUrl) {
      await this.deleteFile(recipe.content.imageUrl);
    }
    await this.recordAudit(actor, 'catalog.recipe.delete', recipe);
    return { deleted: true, market: recipe.market, flavorSlug: recipe.key };
  }

  present({ market, key, variations }, content) {
    const label = content ? content.label : null;
    const completeness = labelCompleteness(label, market);
    return {
      market,
      flavorSlug: key,
      name: content ? content.name : key,
      lifeStage: content ? content.lifeStage : 'adult',
      imageUrl: content ? content.imageUrl : null,
      imageUpdatedAt: content ? content.imageUpdatedAt : null,
      label,
      labelUpdatedAt: content ? content.labelUpdatedAt : null,
      labelStatus: completeness.status,
      labelMissing: completeness.missing,
      variations
    };
  }

  async get(market, flavorSlug) {
    const recipe = await this.resolve(market, flavorSlug);
    return this.present(recipe, recipe.content);
  }

  // Store view of a launched recipe: a flavor with no active variation in the market stays hidden.
  async getPublic(key, market) {
    const recipe = await this.resolveLaunched(market, key);
    const content = await this.repository.findByMarketAndSlug(recipe.market, recipe.key);
    return {
      key: recipe.key,
      market: recipe.market,
      imageUrl: content ? content.imageUrl : null,
      label: content ? content.label : null
    };
  }

  async uploadImage(market, flavorSlug, payload = {}, actor = {}) {
    if (!this.imageStorage || typeof this.imageStorage.write !== 'function') {
      throw new HttpError(503, 'Recipe image storage is not available.');
    }
    const recipe = await this.resolve(market, flavorSlug);
    const processed = await this.processImage({
      mimeType: payload.mimeType,
      buffer: decodeImageBase64(payload.imageBase64)
    });

    const previous = recipe.content;
    const imageUrl = await this.imageStorage.write({ market: recipe.market, flavorSlug: recipe.key, buffer: processed.buffer });
    let content;
    try {
      content = await this.repository.upsertImage({ market: recipe.market, flavorSlug: recipe.key, imageUrl, actorId: actorId(actor) });
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

  // Saves a label as sent, complete or not. A US flavor with an active variation must keep a complete label.
  async saveLabel(market, flavorSlug, input, actor = {}) {
    const recipe = await this.resolve(market, flavorSlug);
    const label = parseRecipeLabel(input);
    const completeness = labelCompleteness(label, recipe.market);
    const active = recipe.variations.filter((variation) => variation.active);
    if (recipe.market === 'US' && active.length > 0 && completeness.status !== 'complete') {
      throw new HttpError(409, 'The label of a US recipe with an active variation must stay complete.', {
        code: RECIPE_CONTENT_IN_USE,
        activeVariations: active.map((variation) => variation.id),
        missing: completeness.missing
      });
    }

    const content = await this.repository.upsertLabel({ market: recipe.market, flavorSlug: recipe.key, label, actorId: actorId(actor) });
    await this.recordAudit(actor, 'catalog.recipe.label.update', recipe);
    return this.present(recipe, content);
  }

  async removeImage(market, flavorSlug, actor = {}) {
    const recipe = await this.resolve(market, flavorSlug);
    const active = recipe.variations.filter((variation) => variation.active);
    if (active.length > 0) {
      throw new HttpError(409, 'The image of a recipe with an active variation cannot be removed.', {
        code: RECIPE_CONTENT_IN_USE,
        activeVariations: active.map((variation) => variation.id)
      });
    }

    const previous = recipe.content;
    if (!previous.imageUrl) {
      return this.present(recipe, previous);
    }
    const content = await this.repository.clearImage({ market: recipe.market, flavorSlug: recipe.key, actorId: actorId(actor) });
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
      metadata: { market: recipe.market, flavorSlug: recipe.key, ...extra }
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
