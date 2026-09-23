const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const { stripeAccountFromMarket } = require('../core/stripe-account');
const { resolveStripeBilling } = require('../infrastructure/stripe/stripe-accounts');
const {
  constrainMarketQuery,
  assertRecordMarket,
  shouldEnforceMarketScope
} = require('../core/admin-market-scope');
const {
  SEED_FLAVOR_ALIASES,
  canonicalFlavorKey,
  flavorKeyFromLabel,
  parseFlavorAliases
} = require('../core/flavors');

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

function parseVariationFlavor(value) {
  if (value == null) {
    return undefined;
  }

  const flavor = String(value).trim();
  if (flavor.length > 64) {
    throw new HttpError(422, 'Variation flavor must be at most 64 characters.');
  }

  return flavor;
}

function parseVariationFlavorSlug(value, flavor) {
  const requested = value == null ? '' : flavorKeyFromLabel(value);
  const inferred = canonicalFlavorKey(requested || flavor || '');
  if (!inferred) {
    return undefined;
  }
  if (inferred.length > 64) {
    throw new HttpError(422, 'Variation flavor slug must be at most 64 characters.');
  }
  return inferred;
}

function parseVariationFlavorAliases(value, flavorSlug) {
  if (value == null) {
    const seeded = SEED_FLAVOR_ALIASES[flavorSlug] || [];
    return seeded.length > 0 ? seeded.join(',') : undefined;
  }

  const aliases = parseFlavorAliases(value);
  return aliases.join(',');
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
    const result = await this.repository.listProducts({
      search: query.search,
      market: query.market,
      markets: this.scopedMarkets(query, actor),
      offset: pagination.offset,
      perPage: pagination.perPage
    });

    return paginatedEnvelope({
      items: await this.annotateDeleteFlags(result.items || []),
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
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
    return annotated;
  }

  async createProduct(payload = {}) {
    const name = String(payload.name || payload.namePt || '').trim();
    if (!name) {
      throw new HttpError(422, 'Product name is required.');
    }

    const country = String(payload.planCountry || 'BR').trim().toUpperCase();
    if (country !== 'BR' && country !== 'US') {
      throw new HttpError(422, 'Plan country must be BR or US.', { code: 'product_country_not_configured' });
    }

    const days = Number(payload.planDays);
    if (!Number.isFinite(days) || days <= 0) {
      throw new HttpError(422, 'Plan days must be greater than zero.', { code: 'product_days_not_configured' });
    }

    const productId = await this.repository.createProduct({
      name,
      slug: payload.slug,
      planCountry: country,
      planDays: days
    });

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

    if (Array.isArray(payload.variants) && payload.variants.length > 0) {
      const product = await this.getProduct(productId);
      await this.saveVariants(product, payload.variants, country);
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

    if (payload.planCountry) {
      const country = String(payload.planCountry).trim().toUpperCase();
      if (country !== 'BR' && country !== 'US') {
        throw new HttpError(422, 'Plan country must be BR or US.', { code: 'product_country_not_configured' });
      }
      await this.repository.upsertPostMeta(product.id, '_cmpb_plan_country', country);
    }

    if (payload.planDays != null) {
      const days = Number(payload.planDays);
      if (!Number.isFinite(days) || days <= 0) {
        throw new HttpError(422, 'Plan days must be greater than zero.', { code: 'product_days_not_configured' });
      }
      await this.repository.upsertPostMeta(product.id, '_cmpb_plan_days', String(days));
    }

    if (Array.isArray(payload.variants)) {
      const country = payload.planCountry
        ? String(payload.planCountry).trim().toUpperCase()
        : product.planCountry;
      await this.saveVariants(product, payload.variants, country);
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
      if (!draft.planCountry || !draft.planDays) {
        throw new HttpError(422, 'Plan country and days are required before publishing.', {
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

  async saveVariants(product, variants, country) {
    const zoneId = zoneIdFromCountry(country);
    const existingIds = new Set((product.variants || []).map((item) => String(item.id)));
    const existingById = new Map((product.variants || []).map((item) => [String(item.id), item]));
    let menuOrder = (product.variants || []).length;

    for (const item of variants) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const id = item.id == null ? '' : String(item.id).trim();
      const name = item.name == null ? undefined : String(item.name);
      const sku = item.sku == null ? undefined : String(item.sku);
      const current = existingById.get(id);
      const flavor = parseVariationFlavor(item.flavor);
      const flavorSlug = current && current.flavorSlug
        ? current.flavorSlug
        : parseVariationFlavorSlug(item.flavorSlug, flavor);
      const flavorAliases = current && current.flavorSlug && item.flavorAliases == null
        ? undefined
        : parseVariationFlavorAliases(item.flavorAliases, flavorSlug);
      const regularPrice = parseVariationPrice(item.regularPrice);

      if (isNewVariationId(id, existingIds)) {
        if (!String(name || '').trim() && !String(sku || '').trim()) {
          throw new HttpError(422, 'New variations require a name or SKU.');
        }

        menuOrder += 1;
        await this.repository.createVariation({
          productId: product.id,
          name: String(name || '').trim(),
          sku: String(sku || '').trim(),
          flavor,
          flavorSlug,
          flavorAliases,
          regularPrice,
          zoneId,
          menuOrder
        });
        continue;
      }

      const currentPrice = current && current.regularPrice != null ? Number(current.regularPrice) : null;
      await this.repository.updateVariation({
        id,
        name,
        sku,
        flavor,
        flavorSlug,
        flavorAliases,
        regularPrice,
        zoneId,
        priceChanged: regularPrice != null && currentPrice !== regularPrice
      });
    }
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

  async sync({ productId, market, currency } = {}) {
    const startedAt = new Date().toISOString();
    const products = productId
      ? [await this.getProduct(productId)]
      : (await this.repository.listProducts({ market, offset: 0, perPage: 200 })).items;

    let created = 0;
    let updated = 0;
    const skipped = [];

    for (const product of products.filter(Boolean)) {
      const country = product.planCountry || (market ? String(market).toUpperCase() : 'BR');
      const mappedCurrency = String(currency || (country === 'US' ? 'USD' : 'BRL')).toLowerCase();

      for (const variant of product.variants) {
        if (!variant.regularPrice) {
          skipped.push({ variationId: variant.id, reason: 'missing_price' });
          continue;
        }

        let stripeBilling = this.stripeBilling;
        try {
          stripeBilling = this.billingFor(country, { forCreation: true });
        } catch (error) {
          if (error && error.details && error.details.code === 'stripe_br_disabled') {
            skipped.push({ variationId: variant.id, reason: 'stripe_br_disabled' });
            continue;
          }
          throw error;
        }
        if (!stripeBilling) {
          continue;
        }

        const nickname = `${product.namePt} - ${variant.name || variant.sku}`;
        const unitAmount = Math.round(Number(variant.regularPrice) * 100);
        const lookupKey = `eden_${product.id}_${variant.id}_${mappedCurrency}_${unitAmount}`;
        const productMap = variant.stripeProductIdsByCurrency || {};
        const mappedProductId = liveStripeId(productMap[mappedCurrency], 'prod_');
        const stripeProductId = mappedProductId
          || (!Object.keys(productMap).length
            ? (liveStripeId(variant.stripeProductId, 'prod_') || liveStripeId(product.stripeProductId, 'prod_'))
            : '');
        const priceArgs = {
          lookupKey,
          currency: mappedCurrency,
          unitAmount,
          nickname
        };
        if (stripeProductId) {
          priceArgs.stripeProductId = stripeProductId;
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
        } else {
          updated += 1;
        }

        await this.repository.upsertPostMeta(variant.id, '_stripe_price_id', priceId);
        await this.repository.upsertPostMeta(variant.id, '_stripe_price_ids_by_currency', JSON.stringify(nextMap));
        await this.repository.upsertPostMeta(variant.id, '_stripe_price_fingerprint', fingerprint);
        await this.repository.upsertPostMeta(variant.id, '_stripe_product_ids_by_currency', JSON.stringify(nextProductMap));
        if (mappedCurrency === 'usd' && (ensured.productId || stripeProductId)) {
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

  status() {
    return this.lastSync;
  }
}

module.exports = {
  AdminCatalogService
};
