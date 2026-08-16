const { HttpError } = require('./http-error');
const { FLAVOR_CATALOG, FLAVOR_KEYS } = require('./flavors');
const { gramsToOz } = require('./simplified-consumption');

const ANONYMOUS_PACK_SIZE_GRAMS = 300;
const OZ_TO_GRAMS = 28.3495;
const FALLBACK_VARIATION_START_ID = {
  BR: 1001,
  US: 2001
};

function roundMoney(value) {
  return Number(Math.max(0, Number(value || 0)).toFixed(2));
}

function sanitizeFlavorSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueSanitizeFlavors(flavors) {
  const seen = new Set();
  const result = [];

  for (const flavor of Array.isArray(flavors) ? flavors : []) {
    const slug = sanitizeFlavorSlug(flavor);
    if (!slug || seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    result.push(slug);
  }

  return result;
}

function parseWeightToGrams(label) {
  const raw = String(label || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = raw.match(/^(\d+(?:\.\d+)?)(oz|g)?$/);

  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  if (match[2] === 'oz') {
    return amount * OZ_TO_GRAMS;
  }

  return amount;
}

function formatPackSizeLabel(grams, country) {
  const sizeGrams = Math.max(0, Number(grams || 0));

  if (country === 'BR') {
    return `${Math.round(sizeGrams)} g`;
  }

  return `${gramsToOz(sizeGrams).toFixed(1)} oz`;
}

function listFallbackCatalogItems(country) {
  const catalog = FLAVOR_CATALOG[country];
  if (!catalog) {
    return [];
  }

  let variationId = FALLBACK_VARIATION_START_ID[country] || 1;
  const items = [];

  for (const pack of catalog.packs) {
    for (const flavor of FLAVOR_KEYS) {
      items.push({
        flavor,
        weight: pack.weight,
        price: pack.prices[flavor],
        currency: catalog.currency,
        variation_id: variationId++,
        product_id: catalog.product.id
      });
    }
  }

  return items;
}

function flattenProductCatalog(payload) {
  const items = [];
  const products = payload && Array.isArray(payload.products) ? payload.products : [];

  for (const product of products) {
    const tags = Array.isArray(product.tags) ? product.tags : [];
    const fallbackFlavor = tags.length > 0 ? (tags[0].slug || tags[0].name || '') : '';
    const variations = Array.isArray(product.variations) ? product.variations : [];

    for (const variation of variations) {
      items.push({
        flavor: variation.flavor || fallbackFlavor,
        weight: variation.weight,
        price: variation.price,
        currency: variation.currency || product.currency,
        variation_id: variation.variation_id,
        product_id: product.product_id
      });
    }
  }

  return items;
}

function indexFlavorVariations(items) {
  const byFlavor = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const flavor = sanitizeFlavorSlug(item && item.flavor);
    const grams = parseWeightToGrams(item && item.weight);
    const price = Number(item && item.price);

    if (!flavor || grams <= 0 || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    if (!byFlavor.has(flavor)) {
      byFlavor.set(flavor, []);
    }

    byFlavor.get(flavor).push({
      flavor,
      grams,
      price,
      weight: item.weight,
      currency: item.currency,
      variation_id: Number(item.variation_id || 0),
      product_id: Number(item.product_id || 0)
    });
  }

  return byFlavor;
}

function pickClosestVariation(variations, targetGrams) {
  let best = null;

  for (const variation of variations) {
    const distance = Math.abs(variation.grams - targetGrams);
    if (
      !best
      || distance < best.distance
      || (distance === best.distance && variation.price < best.variation.price)
    ) {
      best = { variation, distance };
    }
  }

  return best ? best.variation : null;
}

function throwPlanError(status, code, message, errors) {
  throw new HttpError(status, message, errors ? { code, errors } : { code });
}

function buildCatalogPricingSnapshot(lineRequests, catalogItems, market) {
  const country = market && market.country === 'BR' ? 'BR' : 'US';
  const currency = market && market.currency ? market.currency : (country === 'BR' ? 'BRL' : 'USD');
  const byFlavor = indexFlavorVariations(catalogItems);
  const lineItems = [];
  let subtotal = 0;

  for (const request of Array.isArray(lineRequests) ? lineRequests : []) {
    const quantity = Math.trunc(Number(request.quantity || 0));
    const targetGrams = Number(request.target_pack_size_grams || 0);

    if (quantity <= 0 || targetGrams <= 0) {
      continue;
    }

    const flavor = sanitizeFlavorSlug(request.flavor);
    const variations = byFlavor.get(flavor);

    if (!variations || variations.length === 0) {
      throwPlanError(422, 'plan_selection_snapshot_mismatch', 'Plan selection does not match the current recommendation.', {
        pets: 'sabor fora do catalogo'
      });
    }

    const variation = pickClosestVariation(variations, targetGrams);
    if (!variation) {
      throwPlanError(422, 'plan_selection_snapshot_mismatch', 'Plan selection does not match the current recommendation.', {
        pets: 'pack size indisponivel para o sabor'
      });
    }

    const unitPrice = roundMoney(variation.price);
    const lineTotal = roundMoney(unitPrice * quantity);
    subtotal += lineTotal;

    lineItems.push({
      pet_id: String(request.pet_id || ''),
      pet_name: String(request.pet_name || ''),
      flavor,
      quantity,
      pack_size_grams: Math.round(variation.grams),
      pack_size_label: formatPackSizeLabel(variation.grams, country),
      variation_id: variation.variation_id,
      product_id: variation.product_id,
      currency: variation.currency || currency,
      unit_price: unitPrice,
      line_total: lineTotal
    });
  }

  const roundedSubtotal = roundMoney(subtotal);

  return {
    currency,
    subtotal: roundedSubtotal,
    discounted_first_month_total: roundedSubtotal,
    line_items: lineItems
  };
}

function aggregatePetTotals(lineItems) {
  const totals = [];
  const indexByPetId = new Map();

  for (const item of Array.isArray(lineItems) ? lineItems : []) {
    const petId = String(item && item.pet_id || '');
    const lineTotal = Number(item && item.line_total);

    if (!petId || !Number.isFinite(lineTotal) || lineTotal <= 0) {
      continue;
    }

    if (!indexByPetId.has(petId)) {
      indexByPetId.set(petId, totals.length);
      totals.push({
        pet_id: petId,
        pet_name: String(item.pet_name || ''),
        monthly_total: 0
      });
    }

    totals[indexByPetId.get(petId)].monthly_total = roundMoney(
      totals[indexByPetId.get(petId)].monthly_total + lineTotal
    );
  }

  return totals.map((pet) => ({
    ...pet,
    total: pet.monthly_total,
    first_month_total: pet.monthly_total
  }));
}

function buildPlanPreviewResponse(resolved) {
  const catalogPricing = resolved && resolved.catalog_pricing ? resolved.catalog_pricing : {};
  const grandTotal = roundMoney(catalogPricing.subtotal);

  if (grandTotal <= 0) {
    throwPlanError(502, 'invalid_plan_preview_contract', 'Invalid plan preview contract: missing grand total.');
  }

  const firstMonthTotal = grandTotal;
  if (firstMonthTotal <= 0) {
    throwPlanError(502, 'invalid_plan_preview_contract', 'Invalid plan preview contract: missing first month total.');
  }

  const pets = aggregatePetTotals(catalogPricing.line_items);
  if (pets.length === 0) {
    throwPlanError(502, 'invalid_plan_preview_contract', 'Invalid plan preview contract: missing per-pet totals.');
  }

  const totals = {
    grand_total: grandTotal,
    grand_total_monthly: grandTotal,
    first_month_total: firstMonthTotal
  };

  return {
    subscription_term_months: Number(resolved.subscription_term_months || 1),
    country: resolved.country,
    currency: resolved.currency || catalogPricing.currency,
    grand_total: grandTotal,
    grand_total_monthly: grandTotal,
    first_month_total: firstMonthTotal,
    totals,
    pricing: { ...totals },
    pets,
    line_items: Array.isArray(catalogPricing.line_items) ? catalogPricing.line_items : []
  };
}

module.exports = {
  ANONYMOUS_PACK_SIZE_GRAMS,
  OZ_TO_GRAMS,
  aggregatePetTotals,
  buildCatalogPricingSnapshot,
  buildPlanPreviewResponse,
  flattenProductCatalog,
  formatPackSizeLabel,
  indexFlavorVariations,
  listFallbackCatalogItems,
  parseWeightToGrams,
  roundMoney,
  sanitizeFlavorSlug,
  throwPlanError,
  uniqueSanitizeFlavors
};
