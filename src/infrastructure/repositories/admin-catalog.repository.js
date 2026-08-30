const crypto = require('crypto');
const { HttpError } = require('../../core/http-error');

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return Boolean(
    error && (
      error.code === 'ER_NO_SUCH_TABLE' ||
      error.errno === 1146 ||
      /doesn't exist/i.test(message)
    )
  );
}

function parseJsonMeta(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function zoneIdFromCountry(country) {
  const normalized = String(country || '').trim().toUpperCase();
  if (normalized === 'US') {
    return 'us';
  }
  if (normalized === 'BR') {
    return 'br';
  }
  return '';
}

function pickMeta(meta, keys) {
  for (const key of keys) {
    const value = String(meta[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function parsePositivePrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function variationFlavor(meta) {
  return pickMeta(meta, ['attribute_pa_flavor', 'attribute_flavor', 'attribute_sabor']);
}

function variationWeight(meta) {
  return pickMeta(meta, ['attribute_pa_weight', 'attribute_weight', 'attribute_gram', 'attribute_peso']);
}

function variationDisplayName(title, meta) {
  const named = String(title || '').trim();
  if (named) {
    return named;
  }
  return [variationFlavor(meta), variationWeight(meta)].filter(Boolean).join(' ');
}

function variationRegularPrice(meta, zoneId) {
  const candidates = [
    meta._regular_price,
    meta._price,
    zoneId ? meta[`_${zoneId}_regular_price`] : null,
    meta._br_regular_price,
    meta._us_regular_price
  ];

  for (const value of candidates) {
    const parsed = parsePositivePrice(value);
    if (parsed != null) {
      return parsed;
    }
  }

  return null;
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'variation';
}

class AdminCatalogRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableNames = {
      posts: options.postsTableName || 'wp_posts',
      postmeta: options.postmetaTableName || 'wp_postmeta',
      termRelationships: options.termRelationshipsTableName || 'wp_term_relationships'
    };
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async listProducts({ search, market, offset, perPage }) {
    this.ensureDataSource();
    const where = ["p.post_type = 'product'", "p.post_status IN ('publish', 'draft', 'private', 'pending')"];
    const params = [];

    if (search) {
      where.push('(p.post_title LIKE ? OR p.post_name LIKE ?)');
      const needle = `%${String(search).trim()}%`;
      params.push(needle, needle);
    }

    if (market) {
      where.push('UPPER(COALESCE(pm_country.meta_value, "")) = ?');
      params.push(String(market).trim().toUpperCase());
    }

    try {
      const countRows = await this.dataSource.query(
        [
          'SELECT COUNT(DISTINCT p.ID) AS total',
          `FROM \`${this.tableNames.posts}\` p`,
          `LEFT JOIN \`${this.tableNames.postmeta}\` pm_country ON pm_country.post_id = p.ID AND pm_country.meta_key = '_cmpb_plan_country'`,
          `WHERE ${where.join(' AND ')}`
        ].join(' '),
        params
      );
      const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
      const rows = await this.dataSource.query(
        [
          'SELECT p.ID AS id, p.post_title AS name, p.post_name AS slug, p.post_status AS status, p.created_at AS createdAt,',
          'pm_country.meta_value AS planCountry, pm_days.meta_value AS planDays, pm_stripe.meta_value AS stripeProductId',
          `FROM \`${this.tableNames.posts}\` p`,
          `LEFT JOIN \`${this.tableNames.postmeta}\` pm_country ON pm_country.post_id = p.ID AND pm_country.meta_key = '_cmpb_plan_country'`,
          `LEFT JOIN \`${this.tableNames.postmeta}\` pm_days ON pm_days.post_id = p.ID AND pm_days.meta_key = '_cmpb_plan_days'`,
          `LEFT JOIN \`${this.tableNames.postmeta}\` pm_stripe ON pm_stripe.post_id = p.ID AND pm_stripe.meta_key = '_stripe_product_id'`,
          `WHERE ${where.join(' AND ')}`,
          'ORDER BY p.created_at DESC',
          'LIMIT ? OFFSET ?'
        ].join(' '),
        [...params, perPage, offset]
      );

      const items = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const variations = await this.listVariations(row.id, row.planCountry);
        items.push(this.mapProduct(row, variations));
      }

      return { total, items };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { total: 0, items: [] };
      }
      throw error;
    }
  }

  async getProduct(productId) {
    this.ensureDataSource();
    const id = Number(productId);
    if (!Number.isSafeInteger(id) || id < 1) {
      return null;
    }

    const rows = await this.dataSource.query(
      [
        'SELECT p.ID AS id, p.post_title AS name, p.post_name AS slug, p.post_status AS status, p.created_at AS createdAt,',
        'pm_country.meta_value AS planCountry, pm_days.meta_value AS planDays, pm_stripe.meta_value AS stripeProductId',
        `FROM \`${this.tableNames.posts}\` p`,
        `LEFT JOIN \`${this.tableNames.postmeta}\` pm_country ON pm_country.post_id = p.ID AND pm_country.meta_key = '_cmpb_plan_country'`,
        `LEFT JOIN \`${this.tableNames.postmeta}\` pm_days ON pm_days.post_id = p.ID AND pm_days.meta_key = '_cmpb_plan_days'`,
        `LEFT JOIN \`${this.tableNames.postmeta}\` pm_stripe ON pm_stripe.post_id = p.ID AND pm_stripe.meta_key = '_stripe_product_id'`,
        "WHERE p.post_type = 'product' AND p.ID = ?",
        'LIMIT 1'
      ].join(' '),
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      return null;
    }

    const variations = await this.listVariations(id, row.planCountry);
    return this.mapProduct(row, variations);
  }

  async listVariations(productId, country) {
    const rows = await this.dataSource.query(
      [
        'SELECT v.ID AS variationId, v.post_title AS name, v.post_status AS status, vm.meta_key, vm.meta_value',
        `FROM \`${this.tableNames.posts}\` v`,
        `LEFT JOIN \`${this.tableNames.postmeta}\` vm ON vm.post_id = v.ID`,
        "WHERE v.post_type = 'product_variation' AND v.post_parent = ?",
        'ORDER BY v.menu_order ASC, v.ID ASC'
      ].join(' '),
      [productId]
    );

    const grouped = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = Number(row.variationId);
      if (!grouped.has(id)) {
        grouped.set(id, { id: String(id), name: String(row.name || ''), status: row.status, meta: {} });
      }
      if (row.meta_key) {
        grouped.get(id).meta[String(row.meta_key)] = row.meta_value == null ? '' : String(row.meta_value);
      }
    }

    const zoneId = zoneIdFromCountry(country);

    return Array.from(grouped.values()).map((variation) => {
      const pricesByCurrency = parseJsonMeta(variation.meta._stripe_price_ids_by_currency);
      const stripeProductId = String(variation.meta._stripe_product_id || '').trim();
      const stripePriceId = String(variation.meta._stripe_price_id || '').trim();
      const hasPrice = Object.values(pricesByCurrency).some((value) => String(value || '').startsWith('price_'))
        || stripePriceId.startsWith('price_');
      let syncStatus = 'not_synced';
      if (stripeProductId.startsWith('prod_') && hasPrice) {
        syncStatus = variation.meta._stripe_price_fingerprint ? 'synced' : 'price_mismatch';
      }
      const flavor = variationFlavor(variation.meta);
      const weight = variationWeight(variation.meta);
      const sku = pickMeta(variation.meta, ['_sku']) || variation.id;

      return {
        id: variation.id,
        sku,
        name: variationDisplayName(variation.name, variation.meta),
        flavor: flavor || null,
        weight: weight || null,
        active: variation.status === 'publish',
        regularPrice: variationRegularPrice(variation.meta, zoneId),
        stripeProductId: stripeProductId || null,
        stripePriceId: stripePriceId || null,
        stripePriceIdsByCurrency: pricesByCurrency,
        fingerprint: variation.meta._stripe_price_fingerprint || null,
        syncStatus,
        requiresSync: syncStatus !== 'synced' || !stripeProductId
      };
    });
  }

  mapProduct(row, variations) {
    const country = String(row.planCountry || '').trim().toUpperCase();
    const days = Number(row.planDays || 0);
    const currency = country === 'US' ? 'USD' : country === 'BR' ? 'BRL' : '';

    return {
      id: String(row.id),
      slug: String(row.slug || ''),
      namePt: String(row.name || ''),
      nameEn: String(row.name || ''),
      active: row.status === 'publish',
      status: row.status,
      planCountry: country || null,
      planDays: days > 0 ? days : null,
      stripeProductId: String(row.stripeProductId || '').trim() || null,
      createdAt: row.createdAt,
      category: { namePt: 'Planos', nameEn: 'Plans' },
      marketConfigs: country && currency ? [{ marketCountry: country, currency, active: row.status === 'publish' }] : [],
      variants: variations,
      requiresSync: variations.some((variation) => variation.requiresSync)
    };
  }

  async upsertPostMeta(postId, metaKey, metaValue) {
    this.ensureDataSource();
    const existing = await this.dataSource.query(
      `SELECT \`meta_id\` AS id FROM \`${this.tableNames.postmeta}\` WHERE \`post_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
      [postId, metaKey]
    );
    const row = Array.isArray(existing) ? existing[0] : null;
    if (row && row.id) {
      await this.dataSource.query(
        `UPDATE \`${this.tableNames.postmeta}\` SET \`meta_value\` = ? WHERE \`meta_id\` = ?`,
        [metaValue, row.id]
      );
      return;
    }

    await this.dataSource.query(
      `INSERT INTO \`${this.tableNames.postmeta}\` (\`post_id\`, \`meta_key\`, \`meta_value\`) VALUES (?, ?, ?)`,
      [postId, metaKey, metaValue]
    );
  }

  async updatePostStatus(postId, status) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableNames.posts}\` SET \`post_status\` = ? WHERE \`ID\` = ?`,
      [status, postId]
    );
  }

  async nextPostId() {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT COALESCE(MAX(\`ID\`), 0) + 1 AS nextId FROM \`${this.tableNames.posts}\``
    );
    return Number(Array.isArray(rows) && rows[0] ? rows[0].nextId : 1);
  }

  async createProduct({ name, slug, planCountry, planDays }) {
    this.ensureDataSource();
    const id = await this.nextPostId();
    const title = String(name || '').trim();
    const postName = slugify(slug || title || `product-${id}`);

    await this.dataSource.query(
      [
        `INSERT INTO \`${this.tableNames.posts}\``,
        '(`ID`, `post_parent`, `post_type`, `post_status`, `post_title`, `post_name`, `menu_order`)',
        "VALUES (?, 0, 'product', 'draft', ?, ?, 0)"
      ].join(' '),
      [id, title, postName]
    );
    await this.upsertPostMeta(id, '_cmpb_plan_country', planCountry);
    await this.upsertPostMeta(id, '_cmpb_plan_days', String(planDays));
    return String(id);
  }

  async updatePost(postId, fields = {}) {
    this.ensureDataSource();
    const sets = [];
    const params = [];

    if (fields.title != null) {
      sets.push('`post_title` = ?');
      params.push(String(fields.title));
    }
    if (fields.slug != null) {
      sets.push('`post_name` = ?');
      params.push(String(fields.slug));
    }
    if (!sets.length) {
      return;
    }

    params.push(postId);
    await this.dataSource.query(
      `UPDATE \`${this.tableNames.posts}\` SET ${sets.join(', ')} WHERE \`ID\` = ?`,
      params
    );
  }

  async writeVariationPrice(variationId, price, zoneId) {
    const formatted = Number(price).toFixed(2);
    await this.upsertPostMeta(variationId, '_regular_price', formatted);
    await this.upsertPostMeta(variationId, '_price', formatted);
    if (zoneId) {
      await this.upsertPostMeta(variationId, `_${zoneId}_regular_price`, formatted);
    }
    await this.upsertPostMeta(variationId, '_stripe_price_fingerprint', '');
  }

  async createVariation({ productId, name, sku, flavor, regularPrice, zoneId, menuOrder }) {
    this.ensureDataSource();
    const id = await this.nextPostId();
    const title = String(name || '').trim();
    const code = String(sku || '').trim();
    const slug = slugify(code || title || `variation-${id}`);

    await this.dataSource.query(
      [
        `INSERT INTO \`${this.tableNames.posts}\``,
        '(`ID`, `post_parent`, `post_type`, `post_status`, `post_title`, `post_name`, `menu_order`)',
        "VALUES (?, ?, 'product_variation', 'publish', ?, ?, ?)"
      ].join(' '),
      [id, productId, title, slug, menuOrder || 0]
    );

    if (code) {
      await this.upsertPostMeta(id, '_sku', code);
    }
    if (flavor != null) {
      await this.upsertPostMeta(id, 'attribute_pa_flavor', String(flavor).trim());
    }
    if (regularPrice != null) {
      await this.writeVariationPrice(id, regularPrice, zoneId);
    }

    return String(id);
  }

  async updateVariation({ id, name, sku, flavor, regularPrice, zoneId, priceChanged }) {
    this.ensureDataSource();
    const title = name == null ? undefined : String(name).trim();
    const code = sku == null ? undefined : String(sku).trim();
    const nextSlug = code || title;

    await this.updatePost(id, {
      ...(title != null ? { title } : {}),
      ...(nextSlug ? { slug: slugify(nextSlug) } : {})
    });

    if (code != null) {
      await this.upsertPostMeta(id, '_sku', code);
    }
    if (flavor != null) {
      await this.upsertPostMeta(id, 'attribute_pa_flavor', String(flavor).trim());
    }
    if (regularPrice != null && priceChanged !== false) {
      await this.writeVariationPrice(id, regularPrice, zoneId);
    }
  }

  async deleteProduct(productId) {
    this.ensureDataSource();
    const product = await this.getProduct(productId);
    if (!product) {
      return false;
    }

    const ids = [Number(product.id), ...(product.variants || []).map((item) => Number(item.id))];
    await this.deletePosts(ids);
    return true;
  }

  async deleteVariation(productId, variationId) {
    this.ensureDataSource();
    const parentId = Number(productId);
    const id = Number(variationId);
    if (!Number.isSafeInteger(parentId) || parentId < 1 || !Number.isSafeInteger(id) || id < 1) {
      return false;
    }

    const rows = await this.dataSource.query(
      [
        `SELECT \`ID\` AS id FROM \`${this.tableNames.posts}\``,
        "WHERE `ID` = ? AND `post_parent` = ? AND `post_type` = 'product_variation'",
        'LIMIT 1'
      ].join(' '),
      [id, parentId]
    );
    if (!Array.isArray(rows) || !rows[0]) {
      return false;
    }

    await this.deletePosts([id]);
    return true;
  }

  async deletePosts(ids) {
    const unique = [...new Set((ids || [])
      .map((value) => Number(value))
      .filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (!unique.length) {
      return;
    }

    const placeholders = unique.map(() => '?').join(', ');
    await this.dataSource.query(
      `DELETE FROM \`${this.tableNames.postmeta}\` WHERE \`post_id\` IN (${placeholders})`,
      unique
    );

    try {
      await this.dataSource.query(
        `DELETE FROM \`${this.tableNames.termRelationships}\` WHERE \`object_id\` IN (${placeholders})`,
        unique
      );
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }

    await this.dataSource.query(
      `DELETE FROM \`${this.tableNames.posts}\` WHERE \`ID\` IN (${placeholders})`,
      unique
    );
  }

  fingerprint(price, currency) {
    return crypto.createHash('sha256').update(`${Number(price)}|${String(currency).toLowerCase()}|month`).digest('hex');
  }
}

module.exports = {
  AdminCatalogRepository
};
