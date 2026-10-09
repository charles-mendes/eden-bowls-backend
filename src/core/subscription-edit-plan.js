const { HttpError } = require('./http-error');
const { collectPriceItems } = require('./checkout-state');
const { resolveMarket } = require('./market');
const { roundMoney } = require('./plan-catalog-pricing');

function countryFromPayload(payload = {}) {
  const address = payload.address || {};
  const raw = String(address.country || payload.country || 'US').trim().toUpperCase();
  return raw === 'BR' ? 'BR' : 'US';
}

function shippingCostFrom(shipping = {}) {
  const cost = Number(shipping.cost || shipping.total || 0);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

function extractStripeItemRefs(subscription = {}) {
  const data = subscription.items && Array.isArray(subscription.items.data)
    ? subscription.items.data
    : [];

  return data.map((item) => ({
    id: String(item.id || ''),
    price: String(item.price && item.price.id ? item.price.id : item.price || ''),
    quantity: Math.max(1, Number(item.quantity) || 1)
  })).filter((item) => item.price.startsWith('price_'));
}

function diffSubscriptionItems(currentItems, proposedItems) {
  const remaining = proposedItems.map((item) => ({ ...item }));
  const updates = [];

  for (const current of currentItems) {
    const matchIndex = remaining.findIndex((item) => item.price === current.price);
    if (matchIndex >= 0) {
      const proposed = remaining.splice(matchIndex, 1)[0];
      updates.push({
        id: current.id,
        price: current.price,
        quantity: proposed.quantity
      });
    } else if (current.id) {
      updates.push({ id: current.id, deleted: true });
    }
  }

  for (const item of remaining) {
    updates.push({
      price: item.price,
      quantity: item.quantity
    });
  }

  return updates;
}

function mapProrationFromInvoice(invoice = {}, currencyFallback = 'USD') {
  const amountDueMinor = Number(invoice.amount_due == null ? invoice.total : invoice.amount_due) || 0;
  const amountDue = Number((amountDueMinor / 100).toFixed(2));
  const creditMinor = amountDueMinor < 0 ? Math.abs(amountDueMinor) : Number(invoice.starting_balance < 0 ? Math.abs(invoice.starting_balance) : 0);
  let direction = 'none';
  if (amountDue > 0) {
    direction = 'charge';
  } else if (amountDue < 0 || creditMinor > 0) {
    direction = 'credit';
  }

  return {
    direction,
    amount_due_now: Math.max(0, amountDue),
    credit_applied: direction === 'credit' ? Number((creditMinor / 100).toFixed(2)) : 0,
    currency: String(invoice.currency || currencyFallback).toUpperCase()
  };
}

// Stripe keeps one item per price, so two pets on the same recipe share one item with the summed quantity.
function sumByPrice(items) {
  const byPrice = new Map();
  for (const item of items) {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const kept = byPrice.get(item.price);
    byPrice.set(item.price, { price: item.price, quantity: (kept ? kept.quantity : 0) + quantity });
  }
  return [...byPrice.values()];
}

async function resolveProposedPlan(planPreviewRepository, resolveSubscriptionItems, { userId, payload }) {
  if (!planPreviewRepository) {
    throw new HttpError(503, 'Plan preview repository is not available.');
  }

  const country = countryFromPayload(payload);
  const market = resolveMarket({ country });
  const resolved = await planPreviewRepository.previewPlan(userId, {
    subscription_term_months: payload.subscription_term_months,
    pets: payload.pets,
    country
  }, market);

  const planSelection = {
    ...resolved,
    catalog_pricing: resolved.catalog_pricing
  };
  const items = resolveSubscriptionItems
    ? await resolveSubscriptionItems(planSelection)
    : collectPriceItems(planSelection);

  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(422, 'Unable to resolve Stripe prices for the proposed plan.', {
      code: 'invalid_plan'
    });
  }

  return {
    country,
    currency: String((resolved.catalog_pricing && resolved.catalog_pricing.currency) || market.currency || 'USD'),
    resolved,
    planSelection,
    items: sumByPrice(items),
    catalogSubtotal: roundMoney(resolved.catalog_pricing && resolved.catalog_pricing.subtotal)
  };
}

module.exports = {
  countryFromPayload,
  shippingCostFrom,
  extractStripeItemRefs,
  diffSubscriptionItems,
  mapProrationFromInvoice,
  resolveProposedPlan
};
