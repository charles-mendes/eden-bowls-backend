const { HttpError } = require('../core/http-error');
const { labelCompleteness, normalizeRecipeMarket } = require('../core/recipe-content');
const { parseWeightToGrams } = require('../core/plan-catalog-pricing');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const { stripeAccountFromMarket } = require('../core/stripe-account');
const { resolveStripeBilling } = require('../infrastructure/stripe/stripe-accounts');
const {
  constrainMarketQuery,
  assertRecordMarket,
  shouldEnforceMarketScope
} = require('../core/admin-market-scope');
const { LIFE_STAGES, parseFlavorAliases } = require('../core/flavors');

// Small packs a month above which a pet gets the large pack (plan-packaging); null keeps the stored value.
function requiredCurrency(country) {
  if (country === 'US') {
    return 'usd';
  }
  if (country === 'BR') {
    return 'brl';
  }
  return '';
}

function zoneIdFromCountry(country) {
  if (country === 'US') {
    return 'us';
  }
  if (country === 'BR') {
    return 'br';
  }
  return '';
}

const MAX_PRODUCT_NAME_LENGTH = 120;
const MAX_PRODUCT_CODE_LENGTH = 64;
const PRODUCT_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STORE_CATEGORY = 'flavors';

function parseProductName(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name || name.length > MAX_PRODUCT_NAME_LENGTH) {
    throw new HttpError(422, `Product name must have 1 to ${MAX_PRODUCT_NAME_LENGTH} characters.`, { code: 'product_name_invalid' });
  }
  return name;
}

function parseProductCode(value) {
  const code = String(value == null ? '' : value).trim();
  if (!code || code.length > MAX_PRODUCT_CODE_LENGTH || !PRODUCT_CODE_PATTERN.test(code)) {
    throw new HttpError(422, 'Product code must be lowercase letters, digits and single hyphens, up to 64 characters.', {
      code: 'product_code_invalid'
    });
  }
  return code;
}

// Query flags of the products list arrive as strings: 'true' or '1' turns the filter on.
function isTruthyFlag(value) {
  return value === true || value === 'true' || value === '1';
}

function parseProductLifeStage(value) {
  const lifeStage = String(value == null ? '' : value).trim().toLowerCase();
  if (!LIFE_STAGES.includes(lifeStage)) {
    throw new HttpError(422, `Life stage must be one of ${LIFE_STAGES.join(', ')}.`, { code: 'product_life_stage_invalid' });
  }
  return lifeStage;
}

// Undefined keeps the stored value; the store reads the aliases as a comma list of slugs.
function parseProductAliases(value) {
  if (value === undefined) {
    return undefined;
  }
  const aliases = parseFlavorAliases(value == null ? '' : value).join(',');
  if (aliases.length > 512) {
    throw new HttpError(422, 'Flavor aliases must be at most 512 characters.', { code: 'product_aliases_invalid' });
  }
  return aliases;
}

function parseShortLabel(value) {
  if (value === undefined) {
    return undefined;
  }
  const shortLabel = String(value == null ? '' : value).trim();
  if (shortLabel.length > 64) {
    throw new HttpError(422, 'Short name must be at most 64 characters.', { code: 'product_short_label_invalid' });
  }
  return shortLabel;
}

// A payload with only the id and a weight, for a variation stored without weight.
function fillsMissingWeight(item, current) {
  const keys = Object.keys(item).filter((key) => item[key] !== undefined);
  return keys.every((key) => key === 'id' || key === 'weight')
    && String(item.weight == null ? '' : item.weight).trim() !== ''
    && !(gramsOf(current.weight) > 0);
}

// Pack weight as the store reads it (300g, 10.6oz). Undefined keeps the stored value; empty clears it.
function parseVariationWeight(value) {
  if (value === undefined) {
    return undefined;
  }
  const weight = String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, '');
  if (!weight) {
    return '';
  }
  if (weight.length > 32 || !(parseWeightToGrams(weight) > 0)) {
    throw new HttpError(422, 'Variation weight must be like 300g or 10.6oz.', { code: 'variation_weight_invalid' });
  }
  return weight;
}

function gramsOf(weight) {
  return Math.round(parseWeightToGrams(weight || '')) || 0;
}

function identityLocked(field) {
  return new HttpError(422, 'The code and the market of a product cannot change.', { code: 'product_identity_locked', field });
}

// Variation copies of the product's flavor fields (catalog-products).
function flavorCopies(content) {
  return {
    flavor: content.name,
    flavorSlug: content.flavorSlug,
    flavorAliases: content.flavorAliases || '',
    lifeStage: content.lifeStage,
    shortLabel: content.shortLabel || ''
  };
}

// Absent keeps the stored value. The note carries the 8 digits of the NCM.
function parseVariationNcm(value) {
  if (value === undefined) {
    return undefined;
  }
  const ncm = String(value == null ? '' : value).replace(/[.\s-]/g, '');
  if (ncm && !/^\d{8}$/.test(ncm)) {
    throw new HttpError(422, 'NCM must have 8 digits.', { code: 'invalid_ncm' });
  }
  return ncm;
}

function parseVariationOrigin(value) {
  if (value === undefined) {
    return undefined;
  }
  const origin = Number(value);
  if (!Number.isInteger(origin) || origin < 0 || origin > 8) {
    throw new HttpError(422, 'The origin must be a code from 0 to 8.', { code: 'invalid_origin' });
  }
  return origin;
}

function parseReadinessFlag(value) {
  if (value == null || value === '') {
    return undefined;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  throw new HttpError(422, 'Variation readiness flags must be true or false.');
}

const READINESS_FLAGS = [
  ['finalImageReady', 'final_image'],
  ['labelDataReady', 'label_data']
];

function pluralSubscriptions(count) {
  return count === 1 ? '1 active subscription' : `${count} active subscriptions`;
}

function parseVariationPrice(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(422, 'Variation price must be a non-negative number.');
  }

  return parsed;
}

function isNewVariationId(id, existingIds) {
  const normalized = String(id || '').trim();
  return !normalized || normalized.startsWith('new-') || !existingIds.has(normalized);
}

function liveStripeId(value, prefix) {
  const id = String(value || '').trim();
  return id.startsWith(prefix) && !id.includes('_seed_') ? id : '';
}

function unwrapStripePrice(ensured) {
  if (ensured && typeof ensured === 'object') {
    return {
      priceId: String(ensured.priceId || ensured.id || ''),
      productId: String(ensured.productId || '')
    };
  }
  return { priceId: String(ensured || ''), productId: '' };
}

function priceIdsOf(variant = {}) {
  const ids = [];
  const direct = String(variant.stripePriceId || '').trim();
  if (direct.startsWith('price_')) {
    ids.push(direct);
  }
  const map = variant.stripePriceIdsByCurrency;
  if (map && typeof map === 'object') {
    for (const value of Object.values(map)) {
      const price = String(value || '').trim();
      if (price.startsWith('price_')) {
        ids.push(price);
      }
    }
  }
  return ids;
}

function withCanDelete(product, usage) {
  const variants = (product.variants || []).map((variant) => {
    const linked = usage.variationIds.has(String(variant.id))
      || priceIdsOf(variant).some((price) => usage.priceIds.has(price));
    return { ...variant, canDelete: !linked };
  });
  return {
    ...product,
    variants,
    canDelete: variants.every((variant) => variant.canDelete)
  };
}

class AdminCatalogService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.stripeBrEnabled = options.stripeBrEnabled;
    this.syncRunsRepository = options.syncRunsRepository || null;
    this.logger = options.logger || null;
    this.auditService = options.auditService || null;
    this.recipeContentRepository = options.recipeContentRepository || null;
    this.recipeImageStorage = options.recipeImageStorage || null;
    this.lastSync = null;
  }

  billingFor(country, { forCreation = false } = {}) {
    return resolveStripeBilling(this, stripeAccountFromMarket({ country }), { forCreation });
  }

  scopedMarket(query = {}, actor = {}) {
    if (!shouldEnforceMarketScope(actor)) {
      return query.market;
    }
    const scoped = constrainMarketQuery(actor, query);
    if (query.market) {
      return scoped.market || query.market;
    }
    if (Array.isArray(actor.roles) && actor.roles.includes('admin') && !scoped.filtered) {
      return undefined;
    }
    return scoped.market || (scoped.markets.length === 1 ? scoped.markets[0] : undefined);
  }

  scopedMarkets(query = {}, actor = {}) {
    if (!shouldEnforceMarketScope(actor)) {
      return query.market ? [query.market] : undefined;
    }
    const scoped = constrainMarketQuery(actor, query);
    if (Array.isArray(actor.roles) && actor.roles.includes('admin') && !scoped.filtered) {
      return undefined;
    }
    return scoped.markets;
  }

  async listProducts(query, pagination, actor = {}) {
    const markets = this.scopedMarkets(query, actor);
    const contentMarkets = markets || ['BR', 'US'];
    let productIds = query.code ? await this.productIdsWithCode(query.code, contentMarkets) : undefined;
    const lifeStage = query.lifeStage ? parseProductLifeStage(query.lifeStage) : null;
    const noImage = isTruthyFlag(query.noImage);
    const labelIncomplete = isTruthyFlag(query.labelIncomplete);
    let excludeProductIds;
    if (lifeStage || noImage || labelIncomplete) {
      const contents = await this.contentsInMarkets(contentMarkets);
      if (lifeStage) {
        const stageIds = contents.filter((content) => content.lifeStage === lifeStage).map((content) => content.productId);
        productIds = productIds ? productIds.filter((id) => stageIds.includes(id)) : stageIds;
      }
      // A product without content has no image and no label, so these filters keep it.
      excludeProductIds = contents
        .filter((content) => (noImage && content.imageUrl)
          || (labelIncomplete && labelCompleteness(content.label, normalizeRecipeMarket(content.market)).status === 'complete'))
        .map((content) => content.productId);
    }
    const result = await this.repository.listProducts({
      search: query.search,
      market: query.market,
      markets,
      productIds,
      excludeProductIds,
      offset: pagination.offset,
      perPage: pagination.perPage
    });
    const flagged = await this.annotateDeleteFlags(result.items || []);

    return paginatedEnvelope({
      items: await Promise.all(flagged.map((product) => this.annotateRecipeContent(product, { summary: true }))),
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  // Products with this code in the given markets, so an old recipe link can find its product.
  async productIdsWithCode(code, markets) {
    const lookup = this.recipeContentRepository && this.recipeContentRepository.findByMarketAndSlug;
    if (typeof lookup !== 'function') {
      return [];
    }
    const ids = [];
    for (const market of markets) {
      const content = await lookup.call(this.recipeContentRepository, market, String(code).trim().toLowerCase());
      if (content && content.productId) {
        ids.push(content.productId);
      }
    }
    return ids;
  }

  // Content rows of the given markets with a product, for the list filters (Fase, Sem imagem, Rótulo incompleto).
  async contentsInMarkets(markets) {
    const lookup = this.recipeContentRepository && this.recipeContentRepository.listByMarket;
    if (typeof lookup !== 'function') {
      return [];
    }
    const contents = [];
    for (const market of markets) {
      for (const content of await lookup.call(this.recipeContentRepository, market)) {
        if (content && content.productId) {
          contents.push(content);
        }
      }
    }
    return contents;
  }

  async annotateDeleteFlags(products) {
    const list = (products || []).filter(Boolean);
    const variationIds = [];
    const priceIds = [];
    for (const product of list) {
      for (const variant of product.variants || []) {
        if (variant && variant.id != null) {
          variationIds.push(String(variant.id));
        }
        priceIds.push(...priceIdsOf(variant));
      }
    }

    const usage = { variationIds: new Set(), priceIds: new Set() };
    const uniqueVariations = [...new Set(variationIds)];
    const uniquePrices = [...new Set(priceIds)];
    const lookup = this.ledgerRepository && this.ledgerRepository.findReferencedCatalogIds;
    if (typeof lookup === 'function' && (uniqueVariations.length || uniquePrices.length)) {
      const found = await lookup.call(this.ledgerRepository, {
        variationIds: uniqueVariations,
        priceIds: uniquePrices
      });
      usage.variationIds = new Set((found && found.variationIds || []).map(String));
      usage.priceIds = new Set((found && found.priceIds || []).map(String));
    }

    return list.map((product) => withCanDelete(product, usage));
  }

  async getProduct(productId, actor = {}) {
    const product = await this.repository.getProduct(productId);
    if (!product) {
      throw new HttpError(404, 'Product not found.');
    }
    if (shouldEnforceMarketScope(actor)) {
      assertRecordMarket(actor, product.planCountry);
    }
    const [annotated] = await this.annotateDeleteFlags([product]);
    return this.annotateRecipeContent(annotated);
  }

  // The product's content once (recipe-content), and on each variation the product's image, label state and
  // presentation, which the activation checks read. The list carries a summary without label and presentation.
  async annotateRecipeContent(product, { summary = false } = {}) {
    const market = normalizeRecipeMarket(product.planCountry);
    const lookup = this.recipeContentRepository && this.recipeContentRepository.findByProductId;
    const content = typeof lookup === 'function' ? await lookup.call(this.recipeContentRepository, product.id) : null;
    const completeness = labelCompleteness(content ? content.label : null, market);
    const presented = content
      ? {
        code: content.flavorSlug,
        name: content.name,
        lifeStage: content.lifeStage,
        flavorAliases: content.flavorAliases || '',
        shortLabel: content.shortLabel || '',
        imageUrl: content.imageUrl,
        planImageUrl: content.planImageUrl || null,
        labelStatus: completeness.status,
        labelMissing: completeness.missing,
        presentationReady: Boolean(content.presentation),
        ...(summary ? {} : {
          label: content.label,
          labelUpdatedAt: content.labelUpdatedAt || null,
          imageUpdatedAt: content.imageUpdatedAt || null,
          planImageUpdatedAt: content.planImageUpdatedAt || null,
          presentation: content.presentation || null,
          presentationUpdatedAt: content.presentationUpdatedAt || null
        })
      }
      : null;
    return {
      ...product,
      content: presented,
      variants: (product.variants || []).map((variant) => ({
        ...variant,
        recipeImageUrl: content ? content.imageUrl : null,
        recipeLabelStatus: completeness.status,
        recipePresentationReady: Boolean(content && content.presentation)
      }))
    };
  }

  // A product is one recipe of one market (catalog-products): name, market, code and life stage, created as a draft
  // in the store category with its content record.
  async createProduct(payload = {}, actor = {}) {
    const name = parseProductName(payload.name != null ? payload.name : payload.namePt);
    const country = String(payload.planCountry || payload.market || '').trim().toUpperCase();
    if (country !== 'BR' && country !== 'US') {
      throw new HttpError(422, 'Plan country must be BR or US.', { code: 'product_country_not_configured' });
    }
    const code = parseProductCode(payload.code);
    const lifeStage = parseProductLifeStage(payload.lifeStage);
    const codeTaken = () => new HttpError(409, 'A product with this code already exists in the market.', { code: 'product_code_taken' });
    if (await this.recipeContentRepository.findByMarketAndSlug(country, code)) {
      throw codeTaken();
    }

    const productId = await this.repository.createProduct({ name, slug: payload.slug || `${code}-${country.toLowerCase()}`, planCountry: country });
    try {
      await this.recipeContentRepository.createForProduct({ productId, market: country, flavorSlug: code, name, lifeStage, actorId: actorIdOf(actor) });
    } catch (error) {
      // A concurrent create took the code first: the product goes back out.
      await this.repository.deleteProduct(productId);
      if (error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)) {
        throw codeTaken();
      }
      throw error;
    }
    await this.repository.assignCategory(productId, STORE_CATEGORY);

    if (this.stripeAccounts || this.stripeBilling) {
      try {
        const stripeBilling = this.billingFor(country, { forCreation: true });
        const stripeProductId = await stripeBilling.createCatalogProduct({
          name,
          metadata: { catalog_product_id: String(productId), market: country }
        });
        if (country === 'US') {
          await this.repository.upsertPostMeta(productId, '_stripe_product_id', stripeProductId);
        }
        await this.repository.upsertPostMeta(
          productId,
          '_stripe_product_ids_by_currency',
          JSON.stringify({ [requiredCurrency(country)]: stripeProductId })
        );
      } catch (error) {
        if (!error || error.statusCode !== 503) {
          throw error;
        }
      }
    }

    await this.recordProductAudit(actor, 'catalog.product.create', { id: productId, planCountry: country }, { code, name, lifeStage });

    if (Array.isArray(payload.variants) && payload.variants.length > 0) {
      const product = await this.getProduct(productId);
      await this.saveVariants(product, payload.variants, country, actor);
      await this.sync({
        productId,
        market: country,
        currency: requiredCurrency(country).toUpperCase()
      });
    }

    return this.getProduct(productId);
  }

  async deleteProduct(productId, actor = {}) {
    const product = await this.getProduct(productId, actor);
    if (product.canDelete === false) {
      throw new HttpError(409, 'Product is linked to a subscription and cannot be deleted.', {
        code: 'product_in_use'
      });
    }
    await this.archiveStripeCatalog(product);
    await this.repository.deleteProduct(product.id);
    // The content goes with the product, after the Stripe archive succeeded (catalog-product-delete).
    if (this.recipeContentRepository && typeof this.recipeContentRepository.deleteByProductId === 'function') {
      await this.recipeContentRepository.deleteByProductId(product.id);
    }
    for (const imageUrl of [product.content && product.content.imageUrl, product.content && product.content.planImageUrl]) {
      if (imageUrl) {
        await this.deleteImageFile(imageUrl);
      }
    }
    return { deleted: true, id: product.id };
  }

  async deleteVariation(productId, variationId, actor = {}) {
    const product = await this.getProduct(productId, actor);
    const variant = (product.variants || []).find((item) => String(item.id) === String(variationId));
    if (!variant) {
      throw new HttpError(404, 'Variation not found.');
    }
    if (variant.canDelete === false) {
      throw new HttpError(409, 'Variation is linked to a subscription and cannot be deleted.', {
        code: 'variation_in_use'
      });
    }

    await this.archiveStripeCatalog({ variants: [variant], planCountry: product.planCountry });
    const deleted = await this.repository.deleteVariation(product.id, variant.id);
    if (!deleted) {
      throw new HttpError(404, 'Variation not found.');
    }

    return this.getProduct(productId, actor);
  }

  async archiveStripeCatalog(product = {}) {
    const country = product.planCountry || 'US';
    let stripeBilling = null;
    try {
      stripeBilling = this.billingFor(country);
    } catch (_error) {
      stripeBilling = this.stripeBilling;
    }
    if (!stripeBilling || typeof stripeBilling.archiveCatalogProduct !== 'function') {
      return;
    }

    const ids = [];
    const parentId = liveStripeId(product.stripeProductId, 'prod_');
    if (parentId) {
      ids.push(parentId);
    }
    for (const variant of product.variants || []) {
      const variantId = liveStripeId(variant.stripeProductId, 'prod_');
      if (variantId) {
        ids.push(variantId);
      }
    }

    for (const stripeProductId of [...new Set(ids)]) {
      try {
        await stripeBilling.archiveCatalogProduct(stripeProductId);
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        throw new HttpError(502, 'Unable to archive Stripe product.', {
          code: 'stripe_product_archive_failed'
        });
      }
    }
  }

  async patchProduct(productId, payload = {}, actor = {}) {
    const product = await this.getProduct(productId, actor);
    const content = product.content;

    // Code and market are set on create (catalog-products).
    if (payload.planCountry != null && String(payload.planCountry).trim().toUpperCase() !== product.planCountry) {
      throw identityLocked('planCountry');
    }
    if (payload.code != null && (!content || String(payload.code).trim().toLowerCase() !== content.code)) {
      throw identityLocked('code');
    }

    await this.saveProductFields(product, payload, actor);

    if (Array.isArray(payload.variants)) {
      const country = product.planCountry;
      await this.saveVariants(await this.getProduct(productId, actor), payload.variants, country, actor);
      if (!(payload.active === true && !product.active)) {
        try {
          await this.sync({
            productId,
            market: country,
            currency: requiredCurrency(country).toUpperCase()
          });
        } catch (_error) {
          // Draft save should persist even if Stripe is temporarily unavailable.
        }
      }
    }

    if (payload.active === true && !product.active) {
      const draft = await this.getProduct(productId);
      if (!draft.planCountry) {
        throw new HttpError(422, 'Plan country is required before publishing.', {
          code: 'product_incomplete'
        });
      }

      await this.sync({
        productId,
        market: draft.planCountry,
        currency: requiredCurrency(draft.planCountry).toUpperCase()
      });

      const next = await this.getProduct(productId);
      const currency = requiredCurrency(next.planCountry);
      const gaps = next.variants
        .filter((variant) => variant.active)
        .filter((variant) => {
          const mapped = variant.stripePriceIdsByCurrency[currency] || variant.stripePriceId;
          return !String(mapped || '').startsWith('price_');
        })
        .map((variant) => ({ variationId: variant.id, currencies: currency ? [currency.toUpperCase()] : [] }));

      if (gaps.length > 0) {
        await this.repository.updatePostStatus(product.id, 'draft');
        return {
          ...next,
          active: false,
          publishBlocked: true,
          gaps
        };
      }

      await this.repository.updatePostStatus(product.id, 'publish');
    }

    if (payload.active === false && product.active) {
      await this.repository.updatePostStatus(product.id, 'draft');
    }

    return this.getProduct(productId, actor);
  }

  // Name, life stage, aliases and short label of the product: stored on the content and copied to every variation,
  // active or not, since the copies are derived (catalog-products). Each change is audited.
  async saveProductFields(product, payload, actor) {
    const next = {
      name: payload.name === undefined ? undefined : parseProductName(payload.name),
      lifeStage: payload.lifeStage === undefined ? undefined : parseProductLifeStage(payload.lifeStage),
      flavorAliases: parseProductAliases(payload.flavorAliases),
      shortLabel: parseShortLabel(payload.shortLabel)
    };
    const content = product.content;
    const changes = Object.entries(next)
      .filter(([, value]) => value !== undefined)
      .filter(([field, value]) => !content || String(content[field] || '') !== value);
    if (!changes.length) {
      return;
    }
    if (!content) {
      throw new HttpError(409, 'This product has no recipe content.', { code: 'product_content_missing' });
    }

    const fields = Object.fromEntries(changes);
    if (fields.name !== undefined) {
      await this.repository.updatePost(product.id, { title: fields.name });
    }
    const saved = await this.recipeContentRepository.updateProductFields(product.id, { ...fields, actorId: actorIdOf(actor) });
    await this.repository.rewriteFlavorCopies(product.id, flavorCopies(saved));
    for (const [field, value] of changes) {
      await this.recordProductAudit(actor, 'catalog.product.update', product, { field, from: content[field] || null, to: value || null });
    }
  }

  // Variations hold only pack fields; flavor fields come from the product (catalog-products). Every item is
  // checked before anything is written, so a refused weight changes nothing.
  async saveVariants(product, variants, country, actor = {}) {
    const zoneId = zoneIdFromCountry(country);
    const existingIds = new Set((product.variants || []).map((item) => String(item.id)));
    const existingById = new Map((product.variants || []).map((item) => [String(item.id), item]));
    let menuOrder = (product.variants || []).length;
    const content = await this.recipeContentRepository.findByProductId(product.id);
    if (!content) {
      throw new HttpError(409, 'This product has no recipe content.', { code: 'product_content_missing' });
    }
    const copies = flavorCopies(content);

    // A published product keeps its active variations as they are; only inactive ones change. The one exception
    // is a missing weight: sent alone, it can be filled, since without it the pack stays out of the stock.
    if (product.active) {
      const locked = variants
        .filter((item) => item && item.id != null)
        .map((item) => ({ item, current: existingById.get(String(item.id).trim()) }))
        .filter(({ item, current }) => current && current.active && !fillsMissingWeight(item, current))
        .map(({ current }) => String(current.id));
      if (locked.length > 0) {
        throw new HttpError(409, 'Active variations of a published product cannot be edited.', {
          code: 'variation_active_locked',
          variationIds: locked
        });
      }
    }

    const plans = [];
    const grams = new Map((product.variants || []).map((item) => [String(item.id), gramsOf(item.weight)]));
    for (const item of variants) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const id = item.id == null ? '' : String(item.id).trim();
      const isNew = isNewVariationId(id, existingIds);
      const plan = {
        id,
        isNew,
        current: existingById.get(id),
        name: item.name == null ? undefined : String(item.name),
        sku: item.sku == null ? undefined : String(item.sku),
        weight: parseVariationWeight(item.weight),
        regularPrice: parseVariationPrice(item.regularPrice),
        flags: Object.fromEntries(READINESS_FLAGS.map(([key]) => [key, parseReadinessFlag(item[key])])),
        ncm: parseVariationNcm(item.ncm),
        origin: parseVariationOrigin(item.origin)
      };
      if (isNew && !String(plan.name || '').trim() && !String(plan.sku || '').trim()) {
        throw new HttpError(422, 'New variations require a name or SKU.');
      }
      const slot = isNew ? `new:${plans.length}` : id;
      if (plan.weight !== undefined) {
        grams.set(slot, gramsOf(plan.weight));
      }
      const mine = grams.get(slot) || 0;
      const taken = mine > 0 && [...grams.entries()].some(([other, value]) => other !== slot && value === mine);
      if (taken) {
        throw new HttpError(422, 'Another variation of this product already has this weight.', {
          code: 'variation_weight_taken',
          weight: plan.weight
        });
      }
      plans.push(plan);
    }

    for (const plan of plans) {
      if (plan.isNew) {
        menuOrder += 1;
        const createdId = await this.repository.createVariation({
          productId: product.id,
          name: String(plan.name || '').trim(),
          sku: String(plan.sku || '').trim(),
          weight: plan.weight || undefined,
          ...copies,
          recipeKey: copies.flavorSlug,
          ncm: plan.ncm,
          origin: plan.origin,
          ...plan.flags,
          regularPrice: plan.regularPrice,
          zoneId,
          menuOrder
        });
        await this.recordFlagChanges(actor, product, { id: createdId }, plan.flags);
        continue;
      }

      const currentPrice = plan.current && plan.current.regularPrice != null ? Number(plan.current.regularPrice) : null;
      await this.repository.updateVariation({
        id: plan.id,
        name: plan.name,
        sku: plan.sku,
        weight: plan.weight,
        ...copies,
        recipeKey: copies.flavorSlug,
        ncm: plan.ncm,
        origin: plan.origin,
        ...plan.flags,
        regularPrice: plan.regularPrice,
        zoneId,
        priceChanged: plan.regularPrice != null && currentPrice !== plan.regularPrice
      });
      await this.recordFlagChanges(actor, product, plan.current || { id: plan.id }, plan.flags);
    }
  }

  async recordProductAudit(actor, action, product, metadata = {}) {
    if (!this.auditService || typeof this.auditService.record !== 'function') {
      return;
    }
    await this.auditService.record({
      actor,
      action,
      metadata: { productId: String(product.id), market: product.planCountry || null, ...metadata }
    });
  }

  async deleteImageFile(imageUrl) {
    if (!this.recipeImageStorage || typeof this.recipeImageStorage.delete !== 'function') {
      return;
    }
    try {
      await this.recipeImageStorage.delete(imageUrl);
    } catch (error) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error({ err: error && error.message }, 'Failed to delete recipe image file.');
      }
    }
  }

  async recordAudit(actor, action, product, variationId, metadata = {}) {
    if (!this.auditService || typeof this.auditService.record !== 'function') {
      return;
    }
    await this.auditService.record({
      actor,
      action,
      metadata: {
        productId: String(product.id),
        variationId: String(variationId),
        market: product.planCountry || null,
        ...metadata
      }
    });
  }

  async recordFlagChanges(actor, product, current, flags) {
    for (const [key] of READINESS_FLAGS) {
      const next = flags[key];
      const previous = Boolean(current && current[key]);
      if (next === undefined || next === previous) {
        continue;
      }
      await this.recordAudit(actor, 'catalog.variation.flag', product, current.id, { flag: key, from: previous, to: next });
    }
  }

  // Activates or deactivates one variation without touching the product or its other variations.
  async setVariationActive(productId, variationId, active, actor = {}) {
    if (typeof active !== 'boolean') {
      throw new HttpError(422, 'active must be true or false.');
    }
    let product = await this.getProduct(productId, actor);
    let variant = (product.variants || []).find((item) => String(item.id) === String(variationId));
    if (!variant) {
      throw new HttpError(404, 'Variation not found.');
    }
    if (variant.active === active) {
      return product;
    }

    if (active) {
      const country = product.planCountry;
      if (!country) {
        throw new HttpError(422, 'Plan country is required before activating a variation.', { code: 'product_incomplete' });
      }
      const currency = requiredCurrency(country);
      try {
        await this.sync({ productId: product.id, market: country, currency: currency.toUpperCase() });
      } catch (_error) {
        // A failed sync leaves the Stripe price missing, which the checks below report.
      }
      product = await this.getProduct(productId, actor);
      variant = product.variants.find((item) => String(item.id) === String(variationId));

      const missing = [];
      if (!(Number(variant.regularPrice) > 0)) {
        missing.push('price');
      }
      const mapped = (variant.stripePriceIdsByCurrency || {})[currency] || variant.stripePriceId;
      if (!String(mapped || '').startsWith('price_')) {
        missing.push('stripe_price');
      }
      // Stored content or the manual confirmation, while flavors still keep content in the store code.
      if (!variant.finalImageReady && !variant.recipeImageUrl) {
        missing.push('final_image');
      }
      if (country === 'US' && !variant.labelDataReady && variant.recipeLabelStatus !== 'complete') {
        missing.push('label_data');
      }
      // Without it, the first NF-e of this variation stops with an error after the customer paid.
      if (country === 'BR' && !variant.ncm) {
        missing.push('ncm');
      }
      // The store page of the recipe has no other source, so there is no manual confirmation.
      if (!variant.recipePresentationReady) {
        missing.push('presentation');
      }
      if (missing.length > 0) {
        throw new HttpError(422, `Variation cannot be activated: missing ${missing.join(', ')}.`, {
          code: 'recipe_publish_refused',
          missing
        });
      }

      await this.repository.updatePostStatus(variant.id, 'publish');
      await this.recordAudit(actor, 'catalog.variation.activate', product, variant.id);
      return this.getProduct(productId, actor);
    }

    const count = this.ledgerRepository && typeof this.ledgerRepository.countActiveSubscriptionsForCatalog === 'function'
      ? await this.ledgerRepository.countActiveSubscriptionsForCatalog({
        variationIds: [String(variant.id)],
        priceIds: priceIdsOf(variant)
      })
      : 0;
    if (count > 0) {
      throw new HttpError(409, `Variation is used by ${pluralSubscriptions(count)} and cannot be deactivated.`, {
        code: 'variation_in_active_subscriptions',
        activeSubscriptions: count
      });
    }

    await this.repository.updatePostStatus(variant.id, 'draft');
    await this.recordAudit(actor, 'catalog.variation.deactivate', product, variant.id);
    return this.getProduct(productId, actor);
  }

  async listPricing(query, pagination, actor = {}) {
    const products = await this.repository.listProducts({
      market: query.market,
      markets: this.scopedMarkets(query, actor),
      offset: 0,
      perPage: 500
    });
    const currency = String(query.currency || (query.market === 'US' ? 'USD' : 'BRL')).toUpperCase();
    const items = [];

    for (const product of products.items) {
      for (const variant of product.variants) {
        items.push({
          id: `${product.id}:${variant.id}:${currency}`,
          variantId: variant.id,
          currency,
          regularPrice: variant.regularPrice,
          salePrice: null,
          saleFrom: null,
          saleTo: null,
          source: 'postmeta',
          createdAt: product.createdAt,
          product: {
            slug: product.slug,
            namePt: product.namePt,
            nameEn: product.nameEn
          }
        });
      }
    }

    const start = pagination.offset;
    const pageItems = items.slice(start, start + pagination.perPage);
    return paginatedEnvelope({
      items: pageItems,
      total: items.length,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  // Every sync is stored per market touched, failures included, so the status survives restarts.
  async sync(args = {}) {
    const startedAt = new Date().toISOString();
    const progress = { countries: new Map() };
    try {
      const result = await this.runSync(args, startedAt, progress);
      await this.recordRuns(this.runsFor(args, startedAt, progress));
      return result;
    } catch (error) {
      await this.recordRuns(this.failedRunsFor(args, startedAt, progress, error));
      throw error;
    }
  }

  async runSync({ productId, market, currency } = {}, startedAt, progress) {
    const products = productId
      ? [await this.getProduct(productId)]
      : (await this.repository.listProducts({ market, offset: 0, perPage: 200 })).items;

    let created = 0;
    let updated = 0;
    const skipped = [];

    for (const product of products.filter(Boolean)) {
      const country = product.planCountry || (market ? String(market).toUpperCase() : 'BR');
      const mappedCurrency = String(currency || (country === 'US' ? 'USD' : 'BRL')).toLowerCase();
      const tally = progress.countries.get(country) || { currency: mappedCurrency, created: 0, updated: 0, skipped: [] };
      progress.countries.set(country, tally);

      for (const variant of product.variants) {
        if (!variant.regularPrice) {
          skipped.push({ variationId: variant.id, reason: 'missing_price' });
          tally.skipped.push({ variationId: variant.id, reason: 'missing_price' });
          continue;
        }

        let stripeBilling = this.stripeBilling;
        try {
          stripeBilling = this.billingFor(country, { forCreation: true });
        } catch (error) {
          if (error && error.details && error.details.code === 'stripe_br_disabled') {
            skipped.push({ variationId: variant.id, reason: 'stripe_br_disabled' });
            tally.skipped.push({ variationId: variant.id, reason: 'stripe_br_disabled' });
            continue;
          }
          throw error;
        }
        if (!stripeBilling) {
          continue;
        }

        const nickname = `${product.namePt} - ${variant.name || variant.sku}`;
        const unitAmount = Math.round(Number(variant.regularPrice) * 100);
        // A variation moved by the deploy split keeps the lookup key of its old plan product, so no new price is made.
        const lookupKey = `eden_${variant.lookupProductId || product.id}_${variant.id}_${mappedCurrency}_${unitAmount}`;
        const productMap = variant.stripeProductIdsByCurrency || {};
        const mappedProductId = liveStripeId(productMap[mappedCurrency], 'prod_');
        // The single _stripe_product_id meta predates the BR/US split and was created under the old
        // shared key, so only the US account may fall back to it. A BR variant without a brl entry
        // gets a new product in the BR account.
        const legacyProductId = !mappedProductId && !Object.keys(productMap).length && country === 'US'
          ? (liveStripeId(variant.stripeProductId, 'prod_') || liveStripeId(product.stripeProductId, 'prod_'))
          : '';
        const stripeProductId = mappedProductId || legacyProductId;
        const priceArgs = {
          lookupKey,
          currency: mappedCurrency,
          unitAmount,
          nickname
        };
        if (stripeProductId) {
          priceArgs.stripeProductId = stripeProductId;
        }
        if (legacyProductId) {
          priceArgs.recreateMissingProduct = true;
        }
        const ensured = unwrapStripePrice(await stripeBilling.ensureRecurringPrice(priceArgs));
        const priceId = ensured.priceId;
        const fingerprint = this.repository.fingerprint(variant.regularPrice, mappedCurrency);
        const nextMap = {
          ...variant.stripePriceIdsByCurrency,
          [mappedCurrency]: priceId
        };
        const nextProductMap = {
          ...productMap,
          [mappedCurrency]: ensured.productId || stripeProductId
        };

        if (!variant.stripePriceId) {
          created += 1;
          tally.created += 1;
        } else {
          updated += 1;
          tally.updated += 1;
        }

        await this.repository.upsertPostMeta(variant.id, '_stripe_price_id', priceId);
        await this.repository.upsertPostMeta(variant.id, '_stripe_price_ids_by_currency', JSON.stringify(nextMap));
        await this.repository.upsertPostMeta(variant.id, '_stripe_price_fingerprint', fingerprint);
        await this.repository.upsertPostMeta(variant.id, '_stripe_product_ids_by_currency', JSON.stringify(nextProductMap));
        // Checkout requires _stripe_product_id, so each variant keeps the product of its own market's account.
        if (mappedCurrency === requiredCurrency(country) && (ensured.productId || stripeProductId)) {
          await this.repository.upsertPostMeta(variant.id, '_stripe_product_id', ensured.productId || stripeProductId);
        }
      }
    }

    this.lastSync = {
      syncJobId: `sync_${Date.now()}`,
      status: skipped.length && created + updated === 0 ? 'completed_with_skips' : 'completed',
      scope: productId ? 'product' : 'market',
      market,
      currency,
      productId: productId ? String(productId) : undefined,
      createdAt: startedAt,
      updatedAt: new Date().toISOString(),
      summary: { created, updated, skipped }
    };

    return this.lastSync;
  }

  runsFor({ productId, market, currency } = {}, startedAt, progress) {
    const finishedAt = new Date().toISOString();
    const tallies = [...progress.countries.entries()];
    const requested = market ? String(market).toUpperCase() : '';
    if (tallies.length === 0 && (requested === 'BR' || requested === 'US')) {
      tallies.push([requested, { currency: currency || (requested === 'US' ? 'USD' : 'BRL'), created: 0, updated: 0, skipped: [] }]);
    }
    return tallies.map(([country, tally]) => ({
      market: country,
      currency: tally.currency,
      scope: productId ? 'product' : 'market',
      productId,
      status: tally.skipped.length && tally.created + tally.updated === 0 ? 'completed_with_skips' : 'completed',
      summary: { created: tally.created, updated: tally.updated, skipped: tally.skipped },
      startedAt,
      finishedAt
    }));
  }

  failedRunsFor({ productId, market, currency } = {}, startedAt, progress, error) {
    const requested = market ? String(market).toUpperCase() : '';
    const touched = [...progress.countries.keys()];
    let markets = touched;
    if (markets.length === 0) {
      markets = requested === 'BR' || requested === 'US' ? [requested] : ['BR', 'US'];
    }
    const finishedAt = new Date().toISOString();
    return markets.map((country) => {
      const tally = progress.countries.get(country);
      return {
        market: country,
        currency: tally ? tally.currency : currency,
        scope: productId ? 'product' : 'market',
        productId,
        status: 'failed',
        summary: tally ? { created: tally.created, updated: tally.updated, skipped: tally.skipped } : null,
        error: String(error && error.message ? error.message : 'sync_failed'),
        startedAt,
        finishedAt
      };
    });
  }

  async recordRuns(runs) {
    if (!this.syncRunsRepository) {
      return;
    }
    for (const run of runs) {
      try {
        await this.syncRunsRepository.insert(run);
      } catch (error) {
        if (this.logger) {
          this.logger.error({ err: error, market: run.market }, 'Could not store the catalog sync run.');
        }
      }
    }
  }

  async health(query = {}, actor = {}) {
    const market = this.scopedMarket(query, actor) || query.market;
    const currency = query.currency;
    const products = await this.repository.listProducts({
      market,
      markets: this.scopedMarkets({ ...query, market }, actor),
      offset: 0,
      perPage: 500
    });
    const mappedCurrency = String(currency || (market === 'US' ? 'USD' : 'BRL')).toLowerCase();
    const variants = (products.items || []).flatMap((product) => product.variants || []);
    const gaps = [];
    let mapped = 0;

    for (const variant of variants) {
      const priceMap = variant.stripePriceIdsByCurrency || {};
      const priceId = priceMap[mappedCurrency] || variant.stripePriceId;
      if (String(priceId || '').startsWith('price_')) {
        mapped += 1;
      } else {
        gaps.push(variant.id);
      }
    }

    return {
      market: market || 'BR',
      currency: mappedCurrency.toUpperCase(),
      totalExpected: variants.length,
      totalMapped: mapped,
      gaps
    };
  }

  // Newest run within the caller's markets on top (the shape the panel already reads) plus the
  // newest run of each market in `byMarket`.
  async status(marketQuery = {}) {
    const markets = Array.isArray(marketQuery.markets) && marketQuery.markets.length ? marketQuery.markets : ['BR', 'US'];
    let byMarket = {};
    if (this.syncRunsRepository) {
      byMarket = await this.syncRunsRepository.latestByMarket(markets);
    } else if (this.lastSync && markets.includes(String(this.lastSync.market || '').toUpperCase())) {
      byMarket = { [String(this.lastSync.market).toUpperCase()]: this.lastSync };
    }
    const newest = Object.values(byMarket)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    return newest ? { ...newest, byMarket } : { status: null, byMarket };
  }
}

function actorIdOf(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

module.exports = {
  AdminCatalogService
};
