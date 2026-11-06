const { HttpError } = require('./http-error');
const { missingAddressFields } = require('./delivery-address-check');
const { RECIPIENT_NAME_KEY, validateRecipientName } = require('./recipient-name');
const { ledgerStripeAccount } = require('./stripe-account');
const { parseJsonColumn } = require('./stripe-subscription-map');
const { parseCpf, parseFiscalName } = require('./tax-document');
const { collectPriceItems } = require('./checkout-state');
const { resolveMarket } = require('./market');
const { roundMoney } = require('./plan-catalog-pricing');

function countryFromPayload(payload = {}) {
  const address = payload.address || {};
  const raw = String(address.country || payload.country || 'US').trim().toUpperCase();
  return raw === 'BR' ? 'BR' : 'US';
}

function storedAddressOf(row = {}) {
  return parseJsonColumn(row.address) || {};
}

// A subscription never leaves the market of its Stripe account (subscription-contract). An address of another
// country is refused instead of rewritten, and a subscription whose stored address is already of another market
// cannot edit its address at all: that is a market exception, resolved by hand. An address without a country takes
// the account's. A sent address must be complete, with a recipient sent or already stored.
function assertLedgerMarket(payload = {}, row = {}) {
  const country = ledgerStripeAccount(row) === 'br' ? 'BR' : 'US';
  const next = { ...payload, country };
  if (!payload.address) return next;

  const stored = storedAddressOf(row);
  const storedCountry = String(stored.country || '').trim().toUpperCase();
  if (storedCountry && storedCountry !== country) {
    throw new HttpError(422, 'The address of this subscription is from another country. Contact Eden Bowls.', {
      code: 'subscription_market_mismatch'
    });
  }
  const sentCountry = String(payload.address.country || payload.country || '').trim().toUpperCase();
  if (sentCountry && sentCountry !== country) {
    throw new HttpError(422, country === 'BR' ? 'This subscription delivers in Brazil.' : 'This subscription delivers in the United States.', {
      code: 'address_country_mismatch'
    });
  }
  const address = { ...payload.address, country };
  const fields = missingAddressFields(address, country);
  if (fields.length) {
    throw new HttpError(422, 'The delivery address is incomplete.', { code: 'address_incomplete', fields });
  }
  const recipient = address.recipient_name !== undefined ? address.recipient_name : stored[RECIPIENT_NAME_KEY];
  if (!validateRecipientName(recipient)) {
    throw new HttpError(422, 'The recipient name is required.', { code: 'recipient_name_required', field: RECIPIENT_NAME_KEY });
  }
  next.address = address;
  return next;
}

// The CPF and the fiscal name an edit may carry (subscription-contract): Brazil accounts only, with the checkout
// rules. Only what was sent comes back; both belong to the account, not to this subscription.
function parseEditFiscal(payload = {}, row = {}) {
  const sentDocument = payload.tax_document !== undefined;
  const sentName = payload.fiscal_name !== undefined;
  if (!sentDocument && !sentName) return {};
  if (ledgerStripeAccount(row) !== 'br') {
    throw new HttpError(422, 'CPF and fiscal name are only for subscriptions in Brazil.', { code: 'fiscal_fields_not_allowed' });
  }
  const fiscal = {};
  if (sentDocument) {
    fiscal.taxDocument = parseCpf(payload.tax_document);
    if (!fiscal.taxDocument) throw new HttpError(422, 'A valid CPF is required.', { code: 'tax_document_required' });
  }
  if (sentName) {
    fiscal.fiscalName = parseFiscalName(payload.fiscal_name);
    if (!fiscal.fiscalName) throw new HttpError(422, 'The full name is required.', { code: 'fiscal_name_required' });
  }
  return fiscal;
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

function isProrationLine(line) {
  const details = line.parent && line.parent.subscription_item_details;
  return Boolean(line.proration || (details && details.proration));
}

function lineTotalMinor(line) {
  const taxes = Array.isArray(line.taxes) ? line.taxes : [];
  const discounts = Array.isArray(line.discount_amounts) ? line.discount_amounts : [];
  const exclusiveTax = taxes
    .filter((tax) => tax.tax_behavior === 'exclusive')
    .reduce((sum, tax) => sum + (Number(tax.amount) || 0), 0);
  const discount = discounts.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return (Number(line.amount) || 0) - discount + exclusiveTax;
}

// The preview is the whole next invoice: the regular cycle plus any proration. Only the proration is due now.
function mapProrationFromInvoice(invoice = {}, currencyFallback = 'USD') {
  const lines = invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  const amountDueMinor = lines.filter(isProrationLine).reduce((sum, line) => sum + lineTotalMinor(line), 0);
  const amountDue = Number((amountDueMinor / 100).toFixed(2));
  const creditMinor = Math.max(0, -amountDueMinor);
  let direction = 'none';
  if (amountDue > 0) {
    direction = 'charge';
  } else if (amountDue < 0) {
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

async function resolveProposedPlan(planPreviewRepository, resolveSubscriptionItems, { userId, payload, currentSelection = null }) {
  if (!planPreviewRepository) {
    throw new HttpError(503, 'Plan preview repository is not available.');
  }

  const country = countryFromPayload(payload);
  const market = resolveMarket({ country });
  const resolved = await planPreviewRepository.previewPlan(userId, {
    subscription_term_months: payload.subscription_term_months,
    pets: payload.pets,
    country
  }, market, { currentSelection });

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
  assertLedgerMarket,
  parseEditFiscal,
  shippingCostFrom,
  extractStripeItemRefs,
  diffSubscriptionItems,
  mapProrationFromInvoice,
  resolveProposedPlan
};
