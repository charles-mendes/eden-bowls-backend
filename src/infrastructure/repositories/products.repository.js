const { HttpError } = require('../../core/http-error');
const { PRODUCTS_ERROR } = require('../../api/contracts/products-errors');

class ProductsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => new Date();
    this.priceZonePolicyRepository = options.priceZonePolicyRepository || null;
    this.tableNames = {
      posts: options.postsTableName || 'wp_posts',
      postmeta: options.postmetaTableName || 'wp_postmeta',
      terms: options.termsTableName || 'wp_terms',
      termTaxonomy: options.termTaxonomyTableName || 'wp_term_taxonomy',
      termRelationships: options.termRelationshipsTableName || 'wp_term_relationships'
    };
  }

  async listByCategory({ categorySlug, country, currency }) {
    this.ensureDataSourceReady();
    try {
      const category = await this.findCategoryBySlug(categorySlug);

      if (!category) {
        throw new HttpError(PRODUCTS_ERROR.CATEGORY_NOT_FOUND.status, PRODUCTS_ERROR.CATEGORY_NOT_FOUND.message, {
          code: PRODUCTS_ERROR.CATEGORY_NOT_FOUND.code
        });
      }

      const productRows = await this.findProducts(categorySlug, country);
      const zoneId = await this.findZoneIdByCountryCurrency(country, currency);
      const products = [];

      for (const productRow of productRows) {
        const variations = await this.findVariationRowsByProductId(productRow.id);
        const productVariations = this.mapVariations(variations, zoneId, currency, categorySlug);

        if (productVariations.length === 0) {
          continue;
        }

        const tags = await this.findProductTags(productRow.id);
        const startingPrice = productVariations.reduce(
          (minPrice, variation) => Math.min(minPrice, variation.price),
          Number.POSITIVE_INFINITY
        );

        products.push({
          product_id: Number(productRow.id),
          name: String(productRow.name || ''),
          slug: String(productRow.slug || ''),
          country,
          currency,
          days: this.toPositiveInt(productRow.days),
          tags,
          starting_price: Number(startingPrice.toFixed(2)),
          variations: productVariations
        });
      }

      return {
        country,
        currency,
        category: {
          id: Number(category.id),
          slug: String(category.slug || ''),
          name: String(category.name || '')
        },
        products,
        empty: products.length === 0
      };
    } catch (error) {
      if (this.isCatalogMissingError(error)) {
        throw new HttpError(
          PRODUCTS_ERROR.CATALOG_NOT_INITIALIZED.status,
          PRODUCTS_ERROR.CATALOG_NOT_INITIALIZED.message,
          {
            code: PRODUCTS_ERROR.CATALOG_NOT_INITIALIZED.code
          }
        );
      }

      throw error;
    }
  }

  isCatalogMissingError(error) {
    const message = String(error && error.message ? error.message : '');

    return Boolean(
      error && (
        error.code === 'ER_NO_SUCH_TABLE' ||
        error.errno === 1146 ||
        /doesn't exist/i.test(message)
      )
    );
  }

  ensureDataSourceReady() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async findCategoryBySlug(categorySlug) {
    const sql = [
      'SELECT t.term_id AS id, t.slug, t.name',
      `FROM \`${this.tableNames.terms}\` t`,
      `INNER JOIN \`${this.tableNames.termTaxonomy}\` tt ON tt.term_id = t.term_id`,
      "WHERE tt.taxonomy = 'product_cat' AND t.slug = ?",
      'LIMIT 1'
    ].join(' ');

    const rows = await this.dataSource.query(sql, [categorySlug]);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  }

  async findProducts(categorySlug, country) {
    const sql = [
      'SELECT DISTINCT p.ID AS id, p.post_title AS name, p.post_name AS slug, p.menu_order AS menu_order, pm_country.meta_value AS country, pm_days.meta_value AS days',
      `FROM \`${this.tableNames.posts}\` p`,
      `INNER JOIN \`${this.tableNames.termRelationships}\` tr ON tr.object_id = p.ID`,
      `INNER JOIN \`${this.tableNames.termTaxonomy}\` tt ON tt.term_taxonomy_id = tr.term_taxonomy_id`,
      `INNER JOIN \`${this.tableNames.terms}\` t ON t.term_id = tt.term_id`,
      `LEFT JOIN \`${this.tableNames.postmeta}\` pm_country ON pm_country.post_id = p.ID AND pm_country.meta_key = '_cmpb_plan_country'`,
      `LEFT JOIN \`${this.tableNames.postmeta}\` pm_days ON pm_days.post_id = p.ID AND pm_days.meta_key = '_cmpb_plan_days'`,
      "WHERE p.post_type = 'product'",
      "AND p.post_status = 'publish'",
      "AND tt.taxonomy = 'product_cat'",
      'AND t.slug = ?',
      'AND UPPER(COALESCE(pm_country.meta_value, "")) = ?',
      'ORDER BY p.menu_order ASC, p.post_title ASC'
    ].join(' ');

    const rows = await this.dataSource.query(sql, [categorySlug, country]);
    return Array.isArray(rows) ? rows : [];
  }

  async findProductTags(productId) {
    const sql = [
      'SELECT t.term_id AS id, t.name, t.slug',
      `FROM \`${this.tableNames.termRelationships}\` tr`,
      `INNER JOIN \`${this.tableNames.termTaxonomy}\` tt ON tt.term_taxonomy_id = tr.term_taxonomy_id`,
      `INNER JOIN \`${this.tableNames.terms}\` t ON t.term_id = tt.term_id`,
      "WHERE tt.taxonomy = 'product_tag'",
      'AND tr.object_id = ?',
      'ORDER BY t.name ASC'
    ].join(' ');

    const rows = await this.dataSource.query(sql, [productId]);
    const list = Array.isArray(rows) ? rows : [];

    return list.map((tag) => ({
      id: Number(tag.id),
      name: String(tag.name || ''),
      slug: String(tag.slug || '')
    }));
  }

  async findVariationRowsByProductId(productId) {
    const sql = [
      'SELECT v.ID AS variation_id, v.menu_order AS variation_menu_order, vm.meta_key, vm.meta_value',
      `FROM \`${this.tableNames.posts}\` v`,
      `LEFT JOIN \`${this.tableNames.postmeta}\` vm ON vm.post_id = v.ID`,
      "WHERE v.post_type = 'product_variation'",
      "AND v.post_status = 'publish'",
      'AND v.post_parent = ?',
      'ORDER BY v.menu_order ASC, v.ID ASC'
    ].join(' ');

    const rows = await this.dataSource.query(sql, [productId]);
    const list = Array.isArray(rows) ? rows : [];
    const grouped = new Map();

    for (const row of list) {
      const variationId = Number(row.variation_id);

      if (!grouped.has(variationId)) {
        grouped.set(variationId, {
          variation_id: variationId,
          variation_menu_order: Number(row.variation_menu_order || 0),
          meta: {}
        });
      }

      if (row.meta_key) {
        grouped.get(variationId).meta[String(row.meta_key)] = row.meta_value == null ? '' : String(row.meta_value);
      }
    }

    return Array.from(grouped.values());
  }

  mapVariations(variationRows, zoneId, currency, categorySlug) {
    const output = [];

    for (const variation of variationRows) {
      const price = this.resolveVariationPrice(variation, zoneId);

      if (price === null) {
        continue;
      }

      if (categorySlug === 'flavors' && !this.hasStrictStripeBinding(variation, currency)) {
        continue;
      }

      output.push({
        variation_id: Number(variation.variation_id),
        flavor: this.extractVariationFlavor(variation),
        weight: this.extractVariationWeight(variation),
        price: Number(price.toFixed(2)),
        currency
      });
    }

    return output;
  }

  resolveVariationPrice(variation, zoneId) {
    if (!zoneId) {
      return null;
    }

    const meta = variation.meta || {};
    const salePrice = this.toPositiveNumber(meta[`_${zoneId}_sale_price`]);

    if (salePrice !== null && this.isSalePriceActive(meta, zoneId)) {
      return salePrice;
    }

    return this.toPositiveNumber(meta[`_${zoneId}_regular_price`]);
  }

  isSalePriceActive(meta, zoneId) {
    const now = this.nowProvider();
    const saleFrom = this.parseSaleBoundary(meta[`_${zoneId}_sale_price_dates_from`]);
    const saleTo = this.parseSaleBoundary(meta[`_${zoneId}_sale_price_dates_to`]);

    if (saleFrom && now < saleFrom) {
      return false;
    }

    if (saleTo && now > saleTo) {
      return false;
    }

    return true;
  }

  parseSaleBoundary(value) {
    const raw = String(value || '').trim();

    if (!raw) {
      return null;
    }

    if (/^\d+$/.test(raw)) {
      const timestamp = Number(raw);

      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return null;
      }

      const milliseconds = timestamp > 9999999999 ? timestamp : timestamp * 1000;
      const parsedDate = new Date(milliseconds);
      return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
    }

    const parsedMillis = Date.parse(raw);

    if (Number.isNaN(parsedMillis)) {
      return null;
    }

    return new Date(parsedMillis);
  }

  extractVariationFlavor(variation) {
    const meta = variation.meta || {};
    return this.pickFirstMetaValue(meta, [
      'attribute_pa_flavor',
      'attribute_flavor',
      'attribute_sabor'
    ]);
  }

  extractVariationWeight(variation) {
    const meta = variation.meta || {};
    return this.pickFirstMetaValue(meta, [
      'attribute_pa_weight',
      'attribute_weight',
      'attribute_gram',
      'attribute_peso'
    ]);
  }

  pickFirstMetaValue(meta, keys) {
    for (const key of keys) {
      const value = String(meta[key] || '').trim();

      if (value) {
        return value;
      }
    }

    return '';
  }

  async findZoneIdByCountryCurrency(country, currency) {
    if (!this.priceZonePolicyRepository) {
      return null;
    }

    return this.priceZonePolicyRepository.findActiveZoneId(country, currency);
  }

  hasStrictStripeBinding(variation, currency) {
    const meta = variation.meta || {};
    const stripeProductId = String(meta._stripe_product_id || '').trim();
    const stripePriceId = String(meta._stripe_price_id || '').trim();

    if (!stripeProductId.startsWith('prod_') || !stripePriceId.startsWith('price_')) {
      return false;
    }

    const byCurrencyRaw = String(meta._stripe_price_ids_by_currency || '').trim();

    if (!byCurrencyRaw) {
      return false;
    }

    let byCurrency;

    try {
      byCurrency = JSON.parse(byCurrencyRaw);
    } catch (error) {
      return false;
    }

    if (!byCurrency || typeof byCurrency !== 'object') {
      return false;
    }

    const key = String(currency || '').toLowerCase();
    const candidate = byCurrency[key];

    return typeof candidate === 'string' && candidate.startsWith('price_');
  }

  toPositiveNumber(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }

  toPositiveInt(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }

    return Math.trunc(parsed);
  }
}

module.exports = {
  ProductsRepository
};
