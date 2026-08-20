const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');

function requiredCurrency(country) {
  if (country === 'US') {
    return 'usd';
  }
  if (country === 'BR') {
    return 'brl';
  }
  return '';
}

class AdminCatalogService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.stripeBilling = options.stripeBilling || null;
    this.lastSync = null;
  }

  async listProducts(query, pagination) {
    const result = await this.repository.listProducts({
      search: query.search,
      market: query.market,
      offset: pagination.offset,
      perPage: pagination.perPage
    });

    return paginatedEnvelope({
      items: result.items,
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  async getProduct(productId) {
    const product = await this.repository.getProduct(productId);
    if (!product) {
      throw new HttpError(404, 'Product not found.');
    }
    return product;
  }

  async patchProduct(productId, payload = {}) {
    const product = await this.getProduct(productId);

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

    if (payload.active === true && !product.active) {
      const next = await this.getProduct(productId);
      const currency = requiredCurrency(next.planCountry);
      const gaps = next.variants
        .filter((variant) => variant.active)
        .filter((variant) => {
          const mapped = variant.stripePriceIdsByCurrency[currency] || variant.stripePriceId;
          return !String(mapped || '').startsWith('price_');
        })
        .map((variant) => ({ variationId: variant.id, currencies: currency ? [currency.toUpperCase()] : [] }));

      if (!next.planCountry || !next.planDays) {
        throw new HttpError(422, 'Plan country and days are required before publishing.', {
          code: 'product_incomplete'
        });
      }

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

    return this.getProduct(productId);
  }

  async listPricing(query, pagination) {
    const products = await this.repository.listProducts({
      market: query.market,
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

        if (!this.stripeBilling) {
          continue;
        }

        const nickname = `${product.namePt} - ${variant.name || variant.sku}`;
        const lookupKey = `eden_${product.id}_${variant.id}_${mappedCurrency}`;
        const priceId = await this.stripeBilling.ensureRecurringPrice({
          lookupKey,
          currency: mappedCurrency,
          unitAmount: Math.round(Number(variant.regularPrice) * 100),
          nickname
        });
        const fingerprint = this.repository.fingerprint(variant.regularPrice, mappedCurrency);
        const nextMap = {
          ...variant.stripePriceIdsByCurrency,
          [mappedCurrency]: priceId
        };

        if (!variant.stripePriceId) {
          created += 1;
        } else {
          updated += 1;
        }

        await this.repository.upsertPostMeta(variant.id, '_stripe_price_id', priceId);
        await this.repository.upsertPostMeta(variant.id, '_stripe_price_ids_by_currency', JSON.stringify(nextMap));
        await this.repository.upsertPostMeta(variant.id, '_stripe_price_fingerprint', fingerprint);
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

  async health({ market, currency } = {}) {
    const products = await this.repository.listProducts({
      market,
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
