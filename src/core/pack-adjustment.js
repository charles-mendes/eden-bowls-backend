const { HttpError } = require('./http-error');
const { catalogPricesAt, roundMoney } = require('./plan-catalog-pricing');

// Designer copy. The percent is the chosen pack count divided by the suggested count.
const PORTION_WARNING = {
  pt: 'Com {packs} packs, {pet} recebe cerca de {percent}% da porção diária sugerida. Complete com outro alimento ou volte para {suggested} packs.',
  en: 'With {packs} packs, {pet} gets about {percent}% of the recommended daily portion. Add other food or go back to {suggested} packs.'
};

function fill(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template
  );
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function distributeEqual(total, count) {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const rest = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < rest ? 1 : 0));
}

function enabledPets(payload = {}) {
  return (Array.isArray(payload.pets) ? payload.pets : []).filter((pet) => pet && pet.enabled !== false);
}

function assertSomePacks(payload = {}) {
  const total = enabledPets(payload).reduce(
    (sum, pet) => sum + (Array.isArray(pet.flavor_weights) ? pet.flavor_weights : []).reduce(
      (petSum, weight) => petSum + Math.round(positive(weight)),
      0
    ),
    0
  );
  if (total <= 0) {
    throw new HttpError(422, 'Choose at least one pack.', { code: 'no_packs' });
  }
}

function samePet(left = {}, right = {}) {
  const leftId = String(left.pet_id || '');
  const rightId = String(right.pet_id || '');
  if (leftId && rightId) return leftId === rightId;
  return String(left.pet_name || '').trim().toLowerCase() === String(right.pet_name || '').trim().toLowerCase();
}

// The suggestion keeps the pet's current recipes and splits the suggested count evenly, like onboarding does.
function suggestedSplit(suggested, pet, payloadPet, currentSelection) {
  const stored = (Array.isArray(currentSelection && currentSelection.flavors_by_pet) ? currentSelection.flavors_by_pet : [])
    .find((entry) => samePet(entry, pet));
  let flavors = stored && stored.flavors
    ? Object.entries(stored.flavors).filter(([, quantity]) => positive(quantity) > 0).map(([flavor]) => flavor)
    : [];
  if (flavors.length === 0 && payloadPet) {
    const weights = Array.isArray(payloadPet.flavor_weights) ? payloadPet.flavor_weights : [];
    flavors = (payloadPet.selected_flavors || []).filter((_, index) => positive(weights[index]) > 0);
  }
  const counts = distributeEqual(suggested, flavors.length);
  return Object.fromEntries(flavors.map((flavor, index) => [flavor, counts[index]]));
}

// A pack save covers the whole subscription. Pets the request leaves out keep their stored recipes.
function withStoredPets(payload = {}, currentSelection = null) {
  const sent = Array.isArray(payload.pets) ? payload.pets : [];
  const stored = Array.isArray(currentSelection && currentSelection.flavors_by_pet) ? currentSelection.flavors_by_pet : [];
  const missing = stored
    .filter((entry) => entry && entry.flavors && !sent.some((pet) => samePet(pet, entry)))
    .map((entry) => ({
      pet_id: String(entry.pet_id || ''),
      pet_name: String(entry.pet_name || ''),
      enabled: true,
      selected_flavors: Object.keys(entry.flavors),
      flavor_weights: Object.values(entry.flavors).map((quantity) => positive(quantity))
    }))
    .filter((pet) => pet.pet_name && pet.flavor_weights.some((quantity) => quantity > 0));
  return missing.length ? { ...payload, pets: [...sent, ...missing] } : payload;
}

function assertPackOnlyChange(payload = {}, row = {}) {
  const currentTerm = Number(row.subscriptionTermMonths || 1);
  if (Number(payload.subscription_term_months || currentTerm) !== currentTerm) {
    throw new HttpError(422, 'The term cannot change while adjusting packs.', { code: 'term_change_not_allowed' });
  }
  if (payload.address || payload.shipping) {
    throw new HttpError(422, 'The address cannot change while adjusting packs.', { code: 'address_change_not_allowed' });
  }
}

function buildPackAdjustment({
  deliveryId,
  payload = {},
  resolved = {},
  currentSelection = null,
  catalogItems = [],
  language = 'en',
  currency
}) {
  const lineItems = resolved.catalog_pricing && Array.isArray(resolved.catalog_pricing.line_items)
    ? resolved.catalog_pricing.line_items
    : [];
  const payloadPets = enabledPets(payload);
  const pets = (Array.isArray(resolved.pets) ? resolved.pets : []).map((pet) => {
    const chosen = lineItems
      .filter((item) => samePet(item, pet))
      .reduce((sum, item) => sum + positive(item.quantity), 0);
    const suggested = positive(pet.suggested_packs);
    const payloadPet = payloadPets.find((entry) => samePet(entry, pet)) || null;
    let portion = null;
    if (suggested > 0) {
      const percent = Math.round((chosen / suggested) * 100);
      portion = {
        percent,
        warning: chosen < suggested
          ? fill(PORTION_WARNING[language] || PORTION_WARNING.en, {
            packs: chosen,
            pet: pet.pet_name,
            percent,
            suggested
          })
          : null
      };
    }
    const recipes = catalogPricesAt(catalogItems, positive(pet.pack_size_grams)).map((recipe) => ({
      ...recipe,
      quantity: lineItems
        .filter((item) => samePet(item, pet) && item.flavor === recipe.flavor)
        .reduce((sum, item) => sum + positive(item.quantity), 0)
    }));
    return {
      pet_id: String(pet.pet_id || ''),
      pet_name: String(pet.pet_name || ''),
      recipes,
      suggested_count: suggested > 0 ? suggested : null,
      suggested_split: suggested > 0 ? suggestedSplit(suggested, pet, payloadPet, currentSelection) : null,
      chosen_count: chosen,
      portion
    };
  });

  const previousSubtotal = currentSelection && currentSelection.catalog_pricing
    ? currentSelection.catalog_pricing.subtotal
    : null;
  const suggestedKnown = pets.length > 0 && pets.every((pet) => pet.suggested_count !== null);

  return {
    delivery_id: deliveryId,
    pets,
    suggested_count: suggestedKnown ? pets.reduce((sum, pet) => sum + pet.suggested_count, 0) : null,
    chosen_count: pets.reduce((sum, pet) => sum + pet.chosen_count, 0),
    previous_merchandise_total: previousSubtotal == null || previousSubtotal === '' ? null : roundMoney(previousSubtotal),
    new_merchandise_total: roundMoney(resolved.catalog_pricing && resolved.catalog_pricing.subtotal),
    shipping_included: false,
    currency: String(currency || 'USD').toUpperCase()
  };
}

module.exports = {
  PORTION_WARNING,
  assertPackOnlyChange,
  assertSomePacks,
  buildPackAdjustment,
  withStoredPets,
  distributeEqual
};
