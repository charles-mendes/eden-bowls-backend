const { canonicalFlavorKey, LIFE_STAGES } = require('../../../core/flavors');

// Plan of the deploy split (catalog-products): one product per market and recipe key, from the variations of the
// plan products. Pure, so the migration only applies what this returns.

const SPLIT_MARKETS = ['BR', 'US'];
// Variation metas the product owns from now on; the split rewrites them from the product content.
const FLAVOR_COPY_META = ['attribute_pa_flavor', '_flavor_slug', '_recipe_key', '_flavor_aliases', '_life_stage', '_short_label'];
const LOOKUP_PRODUCT_META = '_stripe_lookup_product_id';

const text = (value) => String(value == null ? '' : value).trim();
const byOrder = (a, b) => (a.menuOrder - b.menuOrder) || (a.id - b.id);

function describe(variation) {
  return `variation ${variation.id} (SKU ${variation.sku || '-'})`;
}

// First non-empty value of the variations (menu order, then id); the other non-empty values that differ are logged.
function settle(variations, metaKey, field, logs, product) {
  const withValue = variations.filter((variation) => text(variation.meta[metaKey]));
  const value = withValue.length ? text(withValue[0].meta[metaKey]) : '';
  for (const variation of withValue.slice(1)) {
    if (text(variation.meta[metaKey]) !== value) {
      logs.push(`${product}: ${describe(variation)} had ${field} "${text(variation.meta[metaKey])}", now "${value}".`);
    }
  }
  return value;
}

/**
 * @param products   [{ id, market, status, menuOrder }]
 * @param variations [{ id, productId, status, menuOrder, meta: { metaKey: value } }]
 * @param contents   [{ market, key, name, lifeStage }]
 * @returns {{ offending, groups, drafts, emptiedProductIds, logs }}
 */
function planSplit({ products = [], variations = [], contents = [] }) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const contentByKey = new Map(contents.map((content) => [`${content.market}:${content.key}`, content]));
  const offending = [];
  const logs = [];
  const grouped = new Map();

  for (const variation of [...variations].sort(byOrder)) {
    const product = productById.get(variation.productId);
    const market = product ? text(product.market).toUpperCase() : '';
    const sku = text(variation.meta._sku);
    const key = text(variation.meta._recipe_key);
    const label = text(variation.meta.attribute_pa_flavor);
    // The flavor slug the store and production read: the stored slug, else the key of the flavor label.
    const slug = text(variation.meta._flavor_slug) || canonicalFlavorKey(label, market);
    const entry = { ...variation, market, sku, label };

    if (!SPLIT_MARKETS.includes(market)) {
      offending.push({ id: variation.id, sku, reason: 'its product has no market' });
    } else if (!key) {
      offending.push({ id: variation.id, sku, reason: 'no recipe key' });
    } else if (slug !== key) {
      offending.push({ id: variation.id, sku, reason: `flavor slug "${slug || '-'}" differs from recipe key "${key}"` });
    } else {
      const groupKey = `${market}:${key}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { market, key, variations: [] });
      }
      grouped.get(groupKey).variations.push(entry);
    }
  }

  const groups = [];
  for (const group of grouped.values()) {
    const name = `${group.market} ${group.key}`;
    const first = group.variations[0];
    let content = contentByKey.get(`${group.market}:${group.key}`);
    let registered = false;
    if (!content) {
      // A key used by variations but never registered (seeded variations) is registered as migration 040 did:
      // named after the flavor label of its first variation, with that variation's life stage.
      const stage = text(first.meta._life_stage);
      content = {
        market: group.market,
        key: group.key,
        name: (first.label || group.key).slice(0, 120),
        lifeStage: LIFE_STAGES.includes(stage) ? stage : 'adult'
      };
      registered = true;
      logs.push(`${name}: recipe was not registered; registered as "${content.name}" (${content.lifeStage}).`);
    }
    const productName = text(content.name) || first.label || group.key;
    const lifeStage = LIFE_STAGES.includes(text(content.lifeStage)) ? text(content.lifeStage) : 'adult';
    const aliases = settle(group.variations, '_flavor_aliases', 'aliases', logs, name);
    const shortLabel = settle(group.variations, '_short_label', 'short label', logs, name);

    for (const variation of group.variations) {
      const stage = text(variation.meta._life_stage);
      if (stage && stage !== lifeStage) {
        logs.push(`${name}: ${describe(variation)} had life stage "${stage}", now "${lifeStage}" from the recipe.`);
      }
      if (variation.label && variation.label !== productName) {
        logs.push(`${name}: ${describe(variation)} had flavor "${variation.label}", now "${productName}".`);
      }
    }

    groups.push({
      market: group.market,
      key: group.key,
      name: productName,
      lifeStage,
      aliases,
      shortLabel,
      registered,
      status: group.variations.some((variation) => variation.status === 'publish') ? 'publish' : 'draft',
      menuOrder: Math.min(...group.variations.map((variation) => variation.menuOrder)),
      sourceProductIds: [...new Set(group.variations.map((variation) => variation.productId))],
      variations: group.variations
    });
  }
  groups.sort((a, b) => (a.menuOrder - b.menuOrder) || a.market.localeCompare(b.market) || a.key.localeCompare(b.key));

  const drafts = contents
    .filter((content) => SPLIT_MARKETS.includes(content.market) && !grouped.has(`${content.market}:${content.key}`))
    .map((content) => ({
      market: content.market,
      key: content.key,
      name: text(content.name) || content.key,
      lifeStage: LIFE_STAGES.includes(text(content.lifeStage)) ? text(content.lifeStage) : 'adult'
    }));

  const emptiedProductIds = [...new Set(variations.map((variation) => variation.productId))]
    .filter((id) => productById.has(id));

  return { offending, groups, drafts, emptiedProductIds, logs };
}

module.exports = {
  FLAVOR_COPY_META,
  LOOKUP_PRODUCT_META,
  SPLIT_MARKETS,
  planSplit
};
