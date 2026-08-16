const { FLAVOR_CATALOG, FLAVOR_KEYS } = require('../../../core/flavors');

const FLAVOR_CATEGORY_TERM = { termId: 10, taxonomyId: 100, name: 'Flavors', slug: 'flavors' };
const FLAVOR_TAG_TERMS = {
  beef: { termId: 21, taxonomyId: 221, name: 'beef', slug: 'beef' },
  fish: { termId: 22, taxonomyId: 222, name: 'fish', slug: 'fish' },
  pork: { termId: 23, taxonomyId: 223, name: 'pork', slug: 'pork' },
  turkey: { termId: 24, taxonomyId: 224, name: 'turkey', slug: 'turkey' }
};

const VARIATION_START_ID = {
  BR: 1001,
  US: 2001
};

function formatPrice(value) {
  return Number(value).toFixed(2);
}

function slugifyWeight(weight) {
  return String(weight || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function flavorLabel(flavor) {
  return flavor.charAt(0).toUpperCase() + flavor.slice(1);
}

function listCatalogEntries() {
  const entries = [];

  for (const country of ['BR', 'US']) {
    const catalog = FLAVOR_CATALOG[country];
    let variationId = VARIATION_START_ID[country];
    let menuOrder = 1;

    for (const pack of catalog.packs) {
      for (const flavor of FLAVOR_KEYS) {
        entries.push({
          country,
          catalog,
          flavor,
          weight: pack.weight,
          price: pack.prices[flavor],
          variationId: variationId++,
          menuOrder: menuOrder++
        });
      }
    }
  }

  return entries;
}

function listManagedPostIds() {
  const productIds = Object.values(FLAVOR_CATALOG).map((catalog) => catalog.product.id);
  const variationIds = listCatalogEntries().map((entry) => entry.variationId);
  return [...productIds, ...variationIds];
}

async function seedFlavorCatalog(queryRunner) {
  const postIds = listManagedPostIds();
  const productIds = Object.values(FLAVOR_CATALOG).map((catalog) => catalog.product.id);
  const entries = listCatalogEntries();

  await queryRunner.query(`DELETE FROM \`wp_postmeta\` WHERE \`post_id\` IN (${postIds.join(',')})`);
  await queryRunner.query(`DELETE FROM \`wp_term_relationships\` WHERE \`object_id\` IN (${productIds.join(',')})`);
  await queryRunner.query(`DELETE FROM \`wp_posts\` WHERE \`ID\` IN (${postIds.join(',')})`);

  const termValues = [
    [FLAVOR_CATEGORY_TERM.termId, FLAVOR_CATEGORY_TERM.name, FLAVOR_CATEGORY_TERM.slug],
    ...Object.values(FLAVOR_TAG_TERMS).map((term) => [term.termId, term.name, term.slug])
  ];
  await queryRunner.query(
    'INSERT IGNORE INTO `wp_terms` (`term_id`, `name`, `slug`) VALUES ' +
    termValues.map(() => '(?, ?, ?)').join(', '),
    termValues.flat()
  );

  const taxonomyValues = [
    [FLAVOR_CATEGORY_TERM.taxonomyId, FLAVOR_CATEGORY_TERM.termId, 'product_cat'],
    ...Object.values(FLAVOR_TAG_TERMS).map((term) => [term.taxonomyId, term.termId, 'product_tag'])
  ];
  await queryRunner.query(
    'INSERT IGNORE INTO `wp_term_taxonomy` (`term_taxonomy_id`, `term_id`, `taxonomy`) VALUES ' +
    taxonomyValues.map(() => '(?, ?, ?)').join(', '),
    taxonomyValues.flat()
  );

  const productRows = Object.values(FLAVOR_CATALOG).map((catalog) => [
    catalog.product.id,
    0,
    'product',
    'publish',
    catalog.product.title,
    catalog.product.slug,
    catalog.product.menuOrder
  ]);
  const variationRows = entries.map((entry) => [
    entry.variationId,
    entry.catalog.product.id,
    'product_variation',
    'publish',
    '',
    '',
    entry.menuOrder
  ]);
  const postRows = [...productRows, ...variationRows];
  await queryRunner.query(
    'INSERT INTO `wp_posts` (`ID`, `post_parent`, `post_type`, `post_status`, `post_title`, `post_name`, `menu_order`) VALUES ' +
    postRows.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', '),
    postRows.flat()
  );

  const relationshipRows = [];
  for (const catalog of Object.values(FLAVOR_CATALOG)) {
    relationshipRows.push([catalog.product.id, FLAVOR_CATEGORY_TERM.taxonomyId]);
    for (const flavor of FLAVOR_KEYS) {
      relationshipRows.push([catalog.product.id, FLAVOR_TAG_TERMS[flavor].taxonomyId]);
    }
  }
  await queryRunner.query(
    'INSERT INTO `wp_term_relationships` (`object_id`, `term_taxonomy_id`) VALUES ' +
    relationshipRows.map(() => '(?, ?)').join(', '),
    relationshipRows.flat()
  );

  const metaRows = [];
  for (const catalog of Object.values(FLAVOR_CATALOG)) {
    metaRows.push([catalog.product.id, '_cmpb_plan_country', catalog.country]);
    metaRows.push([catalog.product.id, '_cmpb_plan_days', String(catalog.product.days)]);
  }

  for (const entry of entries) {
    const currencyKey = entry.catalog.currency.toLowerCase();
    const price = formatPrice(entry.price);
    const stripeProductId = `prod_seed_${entry.country.toLowerCase()}_${entry.flavor}_${slugifyWeight(entry.weight)}`;
    const stripePriceId = `price_seed_${entry.country.toLowerCase()}_${entry.flavor}_${slugifyWeight(entry.weight)}`;

    metaRows.push([entry.variationId, `_${entry.catalog.zoneId}_regular_price`, price]);
    metaRows.push([entry.variationId, '_stripe_product_id', stripeProductId]);
    metaRows.push([entry.variationId, '_stripe_price_id', stripePriceId]);
    metaRows.push([
      entry.variationId,
      '_stripe_price_ids_by_currency',
      JSON.stringify({ [currencyKey]: stripePriceId })
    ]);
    metaRows.push([entry.variationId, 'attribute_pa_flavor', flavorLabel(entry.flavor)]);
    metaRows.push([entry.variationId, 'attribute_pa_weight', entry.weight]);
  }

  await queryRunner.query(
    'INSERT INTO `wp_postmeta` (`post_id`, `meta_key`, `meta_value`) VALUES ' +
    metaRows.map(() => '(?, ?, ?)').join(', '),
    metaRows.flat()
  );
}

module.exports = {
  seedFlavorCatalog
};
