const {
  FLAVOR_COPY_META,
  LOOKUP_PRODUCT_META,
  planSplit
} = require('./helpers/split-plan-products');

const NAME = 'SplitPlanProducts1700000000075';
const POSTS = 'wp_posts';
const POSTMETA = 'wp_postmeta';
const TERMS = 'wp_term_relationships';
const CONTENTS = 'recipe_contents';
// What `down` needs to put the plan products back: their posts, metas and terms, each moved variation's parent
// and flavor metas, the products created and the recipes registered by the split. Its presence marks the split done.
const BACKUP = 'catalog_split_backup';

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

async function upsertMeta(queryRunner, postId, key, value) {
  const rows = await queryRunner.query(`SELECT meta_id FROM \`${POSTMETA}\` WHERE post_id = ? AND meta_key = ? LIMIT 1`, [postId, key]);
  if (Array.isArray(rows) && rows.length) {
    await queryRunner.query(`UPDATE \`${POSTMETA}\` SET meta_value = ? WHERE post_id = ? AND meta_key = ?`, [String(value), postId, key]);
  } else {
    await queryRunner.query(`INSERT INTO \`${POSTMETA}\` (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [postId, key, String(value)]);
  }
}

async function backup(queryRunner, kind, refId, payload) {
  await queryRunner.query(`INSERT INTO \`${BACKUP}\` (kind, ref_id, payload) VALUES (?, ?, ?)`, [kind, refId, JSON.stringify(payload)]);
}

// Deploy split of catalog-products: each market's plan product becomes one product per recipe. Variation ids,
// prices and Stripe ids stay; `_stripe_lookup_product_id` keeps the Stripe lookup key of each moved variation.
class SplitPlanProducts1700000000075 {
  name = NAME;

  async up(queryRunner, logger = console) {
    for (const table of [POSTS, POSTMETA, CONTENTS]) {
      if (!(await queryRunner.hasTable(table))) {
        return;
      }
    }
    if (!(await queryRunner.hasColumn(CONTENTS, 'product_id')) || (await queryRunner.hasTable(BACKUP))) {
      return;
    }
    const hasTerms = await queryRunner.hasTable(TERMS);

    const products = (await queryRunner.query(
      `SELECT p.ID AS id, p.post_status AS status, p.menu_order AS menuOrder, UPPER(COALESCE(pc.meta_value, '')) AS market
       FROM \`${POSTS}\` p
       LEFT JOIN \`${POSTMETA}\` pc ON pc.post_id = p.ID AND pc.meta_key = '_cmpb_plan_country'
       WHERE p.post_type = 'product'`
    )).map((row) => ({ id: Number(row.id), status: row.status, menuOrder: Number(row.menuOrder || 0), market: String(row.market || '') }));
    const variationRows = await queryRunner.query(
      `SELECT v.ID AS id, v.post_parent AS productId, v.post_status AS status, v.menu_order AS menuOrder
       FROM \`${POSTS}\` v
       INNER JOIN \`${POSTS}\` p ON p.ID = v.post_parent AND p.post_type = 'product'
       WHERE v.post_type = 'product_variation'`
    );
    const variations = variationRows.map((row) => ({
      id: Number(row.id), productId: Number(row.productId), status: row.status, menuOrder: Number(row.menuOrder || 0), meta: {}
    }));
    const variationById = new Map(variations.map((variation) => [variation.id, variation]));
    if (variations.length) {
      const metas = await queryRunner.query(
        `SELECT post_id AS postId, meta_key AS metaKey, meta_value AS metaValue FROM \`${POSTMETA}\`
         WHERE post_id IN (?) AND meta_key IN (?)`,
        [variations.map((variation) => variation.id), [...FLAVOR_COPY_META, '_sku', LOOKUP_PRODUCT_META]]
      );
      for (const meta of metas) {
        const variation = variationById.get(Number(meta.postId));
        if (variation) {
          variation.meta[meta.metaKey] = meta.metaValue;
        }
      }
    }
    const contents = (await queryRunner.query(
      `SELECT market, flavor_slug AS \`key\`, name, life_stage AS lifeStage FROM \`${CONTENTS}\``
    )).map((row) => ({ market: String(row.market || '').toUpperCase(), key: String(row.key || ''), name: row.name, lifeStage: row.lifeStage }));

    const plan = planSplit({ products, variations, contents });
    if (plan.offending.length) {
      // Nothing was written yet: the operator fixes these variations in the admin and runs the deploy again.
      const lines = plan.offending.map((item) => `- variation ${item.id} (SKU ${item.sku || '-'}): ${item.reason}`);
      throw new Error(`[${NAME}] Split refused, the catalog is unchanged. Fix these variations and run again:\n${lines.join('\n')}`);
    }

    await queryRunner.query(
      `CREATE TABLE \`${BACKUP}\` (
        id int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        kind varchar(16) NOT NULL,
        ref_id bigint unsigned NOT NULL,
        payload json NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    const termsByProduct = new Map();
    if (hasTerms && plan.emptiedProductIds.length) {
      const rows = await queryRunner.query(
        `SELECT object_id AS objectId, term_taxonomy_id AS termId FROM \`${TERMS}\` WHERE object_id IN (?)`,
        [plan.emptiedProductIds]
      );
      for (const row of rows) {
        const list = termsByProduct.get(Number(row.objectId)) || [];
        list.push(Number(row.termId));
        termsByProduct.set(Number(row.objectId), list);
      }
    }
    for (const productId of plan.emptiedProductIds) {
      const [post] = await queryRunner.query(
        `SELECT ID AS id, post_parent AS parent, post_type AS type, post_status AS status, post_title AS title,
                post_name AS slug, menu_order AS menuOrder FROM \`${POSTS}\` WHERE ID = ?`,
        [productId]
      );
      const metas = await queryRunner.query(
        `SELECT meta_key AS metaKey, meta_value AS metaValue FROM \`${POSTMETA}\` WHERE post_id = ? ORDER BY meta_id`,
        [productId]
      );
      await backup(queryRunner, 'plan', productId, { post, metas, terms: termsByProduct.get(productId) || [] });
    }
    for (const variation of variations) {
      const flavorMeta = {};
      for (const key of [...FLAVOR_COPY_META, LOOKUP_PRODUCT_META]) {
        if (variation.meta[key] !== undefined) {
          flavorMeta[key] = variation.meta[key];
        }
      }
      await backup(queryRunner, 'variation', variation.id, { productId: variation.productId, meta: flavorMeta });
    }

    const [{ nextId }] = await queryRunner.query(`SELECT COALESCE(MAX(ID), 0) + 1 AS nextId FROM \`${POSTS}\``);
    let id = Number(nextId);
    const marketTerms = new Map();
    const createProduct = async ({ market, key, name, status, menuOrder, termIds }) => {
      const productId = id++;
      await queryRunner.query(
        `INSERT INTO \`${POSTS}\` (ID, post_parent, post_type, post_status, post_title, post_name, menu_order)
         VALUES (?, 0, 'product', ?, ?, ?, ?)`,
        [productId, status, String(name).slice(0, 255), `${key}-${market.toLowerCase()}`, menuOrder]
      );
      await upsertMeta(queryRunner, productId, '_cmpb_plan_country', market);
      for (const termId of hasTerms ? termIds : []) {
        await queryRunner.query(`INSERT INTO \`${TERMS}\` (object_id, term_taxonomy_id) VALUES (?, ?)`, [productId, termId]);
      }
      await backup(queryRunner, 'created', productId, { market, key });
      return productId;
    };

    let lastOrder = 0;
    for (const group of plan.groups) {
      if (group.registered) {
        await queryRunner.query(
          `INSERT INTO \`${CONTENTS}\` (market, flavor_slug, name, life_stage) VALUES (?, ?, ?, ?)`,
          [group.market, group.key, group.name, group.lifeStage]
        );
        await backup(queryRunner, 'registered', 0, { market: group.market, key: group.key });
      }
      // The plan product's store category and tags.
      const termIds = [...new Set(group.sourceProductIds.flatMap((productId) => termsByProduct.get(productId) || []))];
      marketTerms.set(group.market, [...new Set([...(marketTerms.get(group.market) || []), ...termIds])]);
      const productId = await createProduct({ ...group, termIds });
      lastOrder = Math.max(lastOrder, group.menuOrder);

      const variationIds = group.variations.map((variation) => variation.id);
      await queryRunner.query(`UPDATE \`${POSTS}\` SET post_parent = ? WHERE ID IN (?)`, [productId, variationIds]);
      for (const variation of group.variations) {
        if (!String(variation.meta[LOOKUP_PRODUCT_META] || '').trim()) {
          await upsertMeta(queryRunner, variation.id, LOOKUP_PRODUCT_META, variation.productId);
        }
        await upsertMeta(queryRunner, variation.id, 'attribute_pa_flavor', group.name);
        await upsertMeta(queryRunner, variation.id, '_flavor_slug', group.key);
        await upsertMeta(queryRunner, variation.id, '_recipe_key', group.key);
        await upsertMeta(queryRunner, variation.id, '_life_stage', group.lifeStage);
        if (group.aliases) {
          await upsertMeta(queryRunner, variation.id, '_flavor_aliases', group.aliases);
        }
        if (group.shortLabel) {
          await upsertMeta(queryRunner, variation.id, '_short_label', group.shortLabel);
        }
      }
      await queryRunner.query(
        `UPDATE \`${CONTENTS}\` SET product_id = ?, flavor_aliases = ?, short_label = ? WHERE market = ? AND flavor_slug = ?`,
        [productId, group.aliases || null, group.shortLabel || null, group.market, group.key]
      );
      logger.log(`[${NAME}] ${group.market} ${group.key}: product ${productId} with variation(s) ${variationIds.join(', ')}.`);
    }

    for (const draft of plan.drafts) {
      lastOrder += 1;
      const productId = await createProduct({
        ...draft, status: 'draft', menuOrder: lastOrder, termIds: marketTerms.get(draft.market) || []
      });
      await queryRunner.query(
        `UPDATE \`${CONTENTS}\` SET product_id = ? WHERE market = ? AND flavor_slug = ?`,
        [productId, draft.market, draft.key]
      );
      logger.log(`[${NAME}] ${draft.market} ${draft.key}: draft product ${productId} without variations.`);
    }

    if (plan.emptiedProductIds.length) {
      await queryRunner.query(`DELETE FROM \`${POSTMETA}\` WHERE post_id IN (?)`, [plan.emptiedProductIds]);
      if (hasTerms) {
        await queryRunner.query(`DELETE FROM \`${TERMS}\` WHERE object_id IN (?)`, [plan.emptiedProductIds]);
      }
      await queryRunner.query(`DELETE FROM \`${POSTS}\` WHERE ID IN (?)`, [plan.emptiedProductIds]);
      logger.log(`[${NAME}] removed the plan product(s) ${plan.emptiedProductIds.join(', ')}.`);
    }
    for (const line of plan.logs) {
      logger.log(`[${NAME}] ${line}`);
    }

    const [{ orphans }] = await queryRunner.query(`SELECT COUNT(*) AS orphans FROM \`${CONTENTS}\` WHERE product_id IS NULL`);
    if (Number(orphans) > 0) {
      throw new Error(`[${NAME}] ${orphans} recipe content row(s) outside BR and US have no product.`);
    }
    await queryRunner.query(`ALTER TABLE \`${CONTENTS}\` MODIFY product_id bigint unsigned NOT NULL`);
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(BACKUP))) {
      return;
    }
    const hasTerms = await queryRunner.hasTable(TERMS);
    const rows = (await queryRunner.query(`SELECT kind, ref_id AS refId, payload FROM \`${BACKUP}\` ORDER BY id`))
      .map((row) => ({ kind: row.kind, refId: Number(row.refId), payload: parse(row.payload) }));
    const of = (kind) => rows.filter((row) => row.kind === kind);

    await queryRunner.query(`ALTER TABLE \`${CONTENTS}\` MODIFY product_id bigint unsigned NULL`);

    for (const { refId, payload } of of('plan')) {
      const { post, metas, terms } = payload;
      await queryRunner.query(
        `INSERT INTO \`${POSTS}\` (ID, post_parent, post_type, post_status, post_title, post_name, menu_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [refId, post.parent, post.type, post.status, post.title, post.slug, post.menuOrder]
      );
      for (const meta of metas) {
        await queryRunner.query(`INSERT INTO \`${POSTMETA}\` (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [refId, meta.metaKey, meta.metaValue]);
      }
      for (const termId of hasTerms ? terms : []) {
        await queryRunner.query(`INSERT INTO \`${TERMS}\` (object_id, term_taxonomy_id) VALUES (?, ?)`, [refId, termId]);
      }
    }

    for (const { refId, payload } of of('variation')) {
      await queryRunner.query(`UPDATE \`${POSTS}\` SET post_parent = ? WHERE ID = ?`, [payload.productId, refId]);
      await queryRunner.query(
        `DELETE FROM \`${POSTMETA}\` WHERE post_id = ? AND meta_key IN (?)`,
        [refId, [...FLAVOR_COPY_META, LOOKUP_PRODUCT_META]]
      );
      for (const [key, value] of Object.entries(payload.meta || {})) {
        await queryRunner.query(`INSERT INTO \`${POSTMETA}\` (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [refId, key, value]);
      }
    }

    const created = of('created').map((row) => row.refId);
    if (created.length) {
      await queryRunner.query(`UPDATE \`${CONTENTS}\` SET product_id = NULL WHERE product_id IN (?)`, [created]);
      await queryRunner.query(`DELETE FROM \`${POSTMETA}\` WHERE post_id IN (?)`, [created]);
      if (hasTerms) {
        await queryRunner.query(`DELETE FROM \`${TERMS}\` WHERE object_id IN (?)`, [created]);
      }
      await queryRunner.query(`DELETE FROM \`${POSTS}\` WHERE ID IN (?)`, [created]);
    }
    for (const { payload } of of('registered')) {
      await queryRunner.query(`DELETE FROM \`${CONTENTS}\` WHERE market = ? AND flavor_slug = ?`, [payload.market, payload.key]);
    }
    await queryRunner.query(`UPDATE \`${CONTENTS}\` SET flavor_aliases = NULL, short_label = NULL`);
    await queryRunner.query(`DROP TABLE \`${BACKUP}\``);
  }
}

module.exports = {
  SplitPlanProducts1700000000075
};
