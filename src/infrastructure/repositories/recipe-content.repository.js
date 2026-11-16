const { HttpError } = require('../../core/http-error');
const { parseJsonColumn } = require('../../core/stripe-subscription-map');
const { toIsoDateTime } = require('./onboarding-pets.repository');
const { LIFE_STAGES } = require('../../core/flavors');

const COLUMNS = 'product_id, market, flavor_slug, name, life_stage, flavor_aliases, short_label, image_url, image_updated_at, '
  + 'plan_image_url, plan_image_updated_at, label, label_updated_at, presentation, presentation_updated_at';

// Content of a product (recipe-content): name, life stage, aliases, short label, image, label and store presentation.
// One row per product; market and code (flavor_slug) stay unique, so readers by market and code keep working.
class RecipeContentRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'recipe_contents';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  mapRow(row) {
    if (!row) {
      return null;
    }

    return {
      productId: row.product_id == null ? null : String(row.product_id),
      market: String(row.market || '').toUpperCase(),
      flavorSlug: String(row.flavor_slug || ''),
      name: String(row.name || '').trim() || String(row.flavor_slug || ''),
      lifeStage: LIFE_STAGES.includes(row.life_stage) ? row.life_stage : 'adult',
      flavorAliases: String(row.flavor_aliases || '').trim(),
      shortLabel: String(row.short_label || '').trim(),
      imageUrl: row.image_url ? String(row.image_url) : null,
      imageUpdatedAt: toIsoDateTime(row.image_updated_at),
      planImageUrl: row.plan_image_url ? String(row.plan_image_url) : null,
      planImageUpdatedAt: toIsoDateTime(row.plan_image_updated_at),
      label: parseJsonColumn(row.label),
      labelUpdatedAt: toIsoDateTime(row.label_updated_at),
      presentation: parseJsonColumn(row.presentation),
      presentationUpdatedAt: toIsoDateTime(row.presentation_updated_at)
    };
  }

  async findByMarketAndSlug(market, flavorSlug) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT ${COLUMNS}
       FROM \`${this.tableName}\` WHERE market = ? AND flavor_slug = ? LIMIT 1`,
      [String(market).toUpperCase(), String(flavorSlug)]
    );
    return this.mapRow(Array.isArray(rows) ? rows[0] : null);
  }

  // Content of several flavors of one market, keyed by flavor slug (one query per product detail).
  async findByMarketAndSlugs(market, flavorSlugs) {
    const slugs = [...new Set((flavorSlugs || []).map((slug) => String(slug || '').trim()).filter(Boolean))];
    if (slugs.length === 0) {
      return new Map();
    }
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT ${COLUMNS}
       FROM \`${this.tableName}\` WHERE market = ? AND flavor_slug IN (${slugs.map(() => '?').join(', ')})`,
      [String(market).toUpperCase(), ...slugs]
    );
    return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.flavor_slug), this.mapRow(row)]));
  }

  async listByMarket(market) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT ${COLUMNS}
       FROM \`${this.tableName}\` WHERE market = ? ORDER BY flavor_slug ASC`,
      [String(market).toUpperCase()]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row));
  }

  async findByProductId(productId, manager = null) {
    this.ensureDataSource();
    const rows = await (manager || this.dataSource).query(
      `SELECT ${COLUMNS} FROM \`${this.tableName}\` WHERE product_id = ? LIMIT 1`,
      [Number(productId)]
    );
    return this.mapRow(Array.isArray(rows) ? rows[0] : null);
  }

  // The content row of a new product (catalog-products): no image, label or presentation yet.
  async createForProduct({ productId, market, flavorSlug, name, lifeStage = 'adult', flavorAliases = null, shortLabel = null, actorId = null }, manager = null) {
    this.ensureDataSource();
    await (manager || this.dataSource).query(
      `INSERT INTO \`${this.tableName}\` (product_id, market, flavor_slug, name, life_stage, flavor_aliases, short_label, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number(productId), String(market).toUpperCase(), String(flavorSlug), String(name), String(lifeStage),
        flavorAliases || null, shortLabel || null, actorId]
    );
    return this.findByProductId(productId, manager);
  }

  // Name, life stage, aliases and short label of a product's content; a field left undefined keeps its value.
  async updateProductFields(productId, { name, lifeStage, flavorAliases, shortLabel, actorId = null }, manager = null) {
    this.ensureDataSource();
    const sets = [];
    const params = [];
    // Name and life stage are required text; empty aliases or short label are stored as null.
    const fields = [['name', name, false], ['life_stage', lifeStage, false], ['flavor_aliases', flavorAliases, true], ['short_label', shortLabel, true]];
    for (const [column, value, nullable] of fields) {
      if (value !== undefined) {
        sets.push(`${column} = ?`);
        params.push(nullable && !value ? null : String(value));
      }
    }
    if (sets.length) {
      await (manager || this.dataSource).query(
        `UPDATE \`${this.tableName}\` SET ${[...sets, 'updated_by = ?'].join(', ')} WHERE product_id = ?`,
        [...params, actorId, Number(productId)]
      );
    }
    return this.findByProductId(productId, manager);
  }

  async deleteByProductId(productId, manager = null) {
    this.ensureDataSource();
    await (manager || this.dataSource).query(`DELETE FROM \`${this.tableName}\` WHERE product_id = ?`, [Number(productId)]);
  }

  async update(productId, sets, params, actorId) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET ${[...sets, 'updated_by = ?'].join(', ')} WHERE product_id = ?`,
      [...params, actorId, Number(productId)]
    );
    return this.findByProductId(productId);
  }

  setImage({ productId, imageUrl, actorId = null }) {
    return this.update(productId, ['image_url = ?', 'image_updated_at = CURRENT_TIMESTAMP'], [imageUrl == null ? null : String(imageUrl)], actorId);
  }

  setPlanImage({ productId, imageUrl, actorId = null }) {
    return this.update(productId, ['plan_image_url = ?', 'plan_image_updated_at = CURRENT_TIMESTAMP'], [imageUrl == null ? null : String(imageUrl)], actorId);
  }

  setLabel({ productId, label, actorId = null }) {
    return this.update(productId, ['label = ?', 'label_updated_at = CURRENT_TIMESTAMP'], [JSON.stringify(label)], actorId);
  }

  // Presentation of a product, replaced whole.
  setPresentation({ productId, presentation, actorId = null }) {
    return this.update(productId, ['presentation = ?', 'presentation_updated_at = CURRENT_TIMESTAMP'], [JSON.stringify(presentation)], actorId);
  }
}

module.exports = {
  RecipeContentRepository
};
