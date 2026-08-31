const { HttpError } = require('./http-error');

function hasPlanSelectionPets(plan = null) {
  if (!plan || !Array.isArray(plan.pets)) {
    return false;
  }

  return plan.pets.some((pet) => {
    if (!pet || typeof pet !== 'object' || pet.enabled === false) {
      return false;
    }

    return Boolean(String(pet.pet_id || pet.id || pet.pet_name || pet.name || '').trim());
  });
}

function hasPets(context = {}) {
  if (Array.isArray(context.pets) && context.pets.length > 0) {
    return true;
  }

  return hasPlanSelectionPets(context.planSelection);
}

function isPricedPlanSelection(plan = null) {
  const catalog = plan && plan.catalog_pricing;
  if (!plan || !catalog) {
    return false;
  }

  const lineItems = Array.isArray(catalog.line_items) ? catalog.line_items : [];
  const subtotal = Number(catalog.subtotal);
  return lineItems.length > 0 || (Number.isFinite(subtotal) && subtotal > 0);
}

function hasPlanSelection(context = {}) {
  return isPricedPlanSelection(context.planSelection);
}

function canResolvePlanSelection(plan = null) {
  if (!plan || typeof plan !== 'object') {
    return false;
  }

  const pets = Array.isArray(plan.pets) ? plan.pets : [];
  return pets.some((pet) => {
    if (!pet || typeof pet !== 'object' || pet.enabled === false) {
      return false;
    }

    const flavors = Array.isArray(pet.selected_flavors) ? pet.selected_flavors : [];
    const weights = Array.isArray(pet.flavor_weights) ? pet.flavor_weights : [];
    return flavors.length > 0 && weights.length === flavors.length;
  });
}

function hasAddress(context = {}) {
  const address = context.address || {};
  return Boolean(address.country && address.zipcode && address.state && address.city);
}

function hasShipping(context = {}) {
  const shipping = context.shipping || {};
  return Boolean(String(shipping.rate_id || shipping.method_id || '').trim());
}

function hasRecurrence(context = {}) {
  const recurrence = context.recurrence;
  if (!recurrence || typeof recurrence !== 'object') {
    return false;
  }

  return Object.keys(recurrence).length > 0;
}

function validateCheckoutState(context = {}) {
  const missing = [];

  if (!hasPets(context)) {
    missing.push('pets');
  }
  if (!hasPlanSelection(context)) {
    missing.push('plan_selection');
  }
  if (!hasAddress(context)) {
    missing.push('address');
  }
  if (!hasShipping(context)) {
    missing.push('shipping');
  }
  if (!hasRecurrence(context)) {
    missing.push('recurrence');
  }

  if (missing.length > 0) {
    throw new HttpError(422, 'Onboarding checkout is incomplete.', {
      code: 'session_incomplete',
      missing
    });
  }
}

function collectPriceItems(planSelection = {}) {
  const items = [];
  const catalog = planSelection.catalog_pricing || {};
  const lineItems = Array.isArray(catalog.line_items) ? catalog.line_items : [];

  for (const line of lineItems) {
    const priceId = String(line.stripe_price_id || line.price_id || '').trim();
    const quantity = Math.max(1, Math.trunc(Number(line.quantity) || 1));
    const pricedItem = {
      price: priceId.startsWith('price_') ? priceId : '',
      quantity,
      variation_id: Number(line.variation_id || 0),
      unit_price: Number(line.unit_price),
      currency: String(line.currency || catalog.currency || '').toLowerCase()
    };
    if (pricedItem.price || pricedItem.variation_id) {
      items.push(pricedItem);
    }
  }

  if (items.length === 0) {
    const pets = Array.isArray(planSelection.pets) ? planSelection.pets : [];
    for (const pet of pets) {
      const priceIds = Array.isArray(pet.price_ids) ? pet.price_ids : [];
      for (const priceId of priceIds) {
        if (typeof priceId === 'string' && priceId.startsWith('price_')) {
          items.push({ price: priceId, quantity: 1, variation_id: 0 });
        }
      }
    }
  }

  return items;
}

module.exports = {
  canResolvePlanSelection,
  collectPriceItems,
  hasPlanSelectionPets,
  isPricedPlanSelection,
  validateCheckoutState
};
