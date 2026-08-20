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

class AdminCatalogRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableNames = {
      posts: options.postsTableName || 'wp_posts',
      postmeta: options.postmetaTableName || 'wp_postmeta'
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
          'SELECT p.ID AS id, p.post_title AS name, p.post_name AS slug, p.post_status AS status, p.post_date AS createdAt,',
          'pm_country.meta_value AS planCountry, pm_days.meta_value AS planDays',
          `FROM \`${this.tableNames.posts}\` p`,
          `LEFT JOIN \`${this.tableNames.postmeta}\` pm_country ON pm_country.post_id = p.ID AND pm_country.meta_key = '_cmpb_plan_country'`,
          `LEFT JOIN \`${this.tableNames.postmeta}\` pm_days ON pm_days.post_id = p.ID AND pm_days.meta_key = '_cmpb_plan_days'`,
          `WHERE ${where.join(' AND ')}`,
          'ORDER BY p.post_date DESC',
          'LIMIT ? OFFSET ?'
        ].join(' '),
        [...params, perPage, offset]
      );

      const items = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const variations = await this.listVariations(row.id);
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
        'SELECT p.ID AS id, p.post_title AS name, p.post_name AS slug, p.post_status AS status, p.post_date AS createdAt,',
        'pm_country.meta_value AS planCountry, pm_days.meta_value AS planDays',
        `FROM \`${this.tableNames.posts}\` p`,
        `LEFT JOIN \`${this.tableNames.postmeta}\` pm_country ON pm_country.post_id = p.ID AND pm_country.meta_key = '_cmpb_plan_country'`,
        `LEFT JOIN \`${this.tableNames.postmeta}\` pm_days ON pm_days.post_id = p.ID AND pm_days.meta_key = '_cmpb_plan_days'`,
        "WHERE p.post_type = 'product' AND p.ID = ?",
        'LIMIT 1'
      ].join(' '),
      [id]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      return null;
    }

    const variations = await this.listVariations(id);
    return this.mapProduct(row, variations);
  }

  async listVariations(productId) {
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

      return {
        id: variation.id,
        sku: String(variation.meta._sku || variation.id),
        name: variation.name,
        active: variation.status === 'publish',
        regularPrice: Number(variation.meta._regular_price || variation.meta._price || 0) || null,
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

  fingerprint(price, currency) {
    return crypto.createHash('sha256').update(`${Number(price)}|${String(currency).toLowerCase()}|month`).digest('hex');
  }
}

module.exports = {
  AdminCatalogRepository
};
