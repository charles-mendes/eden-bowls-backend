// What the customer pays for shipping (customer-shipping-charge). US: the quote is charged only while the US setting
// `charge_shipping` is on; otherwise the customer pays 0 and the quote is the company's cost. BR: one fee per order by
// distance, always charged, whatever the number of boxes. The store shows the shipping from these fields alone.

function amountOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Number(number.toFixed(2)) : 0;
}

function marketOf(market) {
  return String(market || '').trim().toUpperCase() === 'US' ? 'US' : 'BR';
}

function customerShipping({ market, quote, chargeEnabled } = {}) {
  const original = amountOf(quote);
  if (marketOf(market) === 'BR') {
    return { original_amount: original, charged_amount: original, charge_enabled: true, company_cost: null };
  }
  const enabled = chargeEnabled === true;
  return {
    original_amount: original,
    charged_amount: enabled ? original : 0,
    charge_enabled: enabled,
    company_cost: enabled ? null : original
  };
}

// A subscription keeps the condition it was checked out with. `shipping_waived` true means the customer pays no
// shipping; anything else (including a subscription created before this rule) means charged.
function isShippingWaived(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function minorOf(amount) {
  return Math.round(amountOf(amount) * 100);
}

// The shipping a checkout charges, from the selected (signed) quote and the switch read when the checkout is placed.
// `cost` and `total` become what the customer pays, so Stripe, the checkout totals and the ledger shipping cost see 0
// when it is waived; the quote stays in `original_amount`, `shipping_original_minor` and `company_cost`.
function checkoutShipping({ market, shipping = {}, chargeEnabled, currency } = {}) {
  const quote = Number(shipping.cost || shipping.total || 0);
  const charge = customerShipping({ market, quote, chargeEnabled });
  const isUs = marketOf(market) === 'US';
  const waived = isUs && !charge.charge_enabled;
  const next = {
    ...shipping,
    original_amount: charge.original_amount,
    charged_amount: charge.charged_amount,
    charge_enabled: charge.charge_enabled
  };
  if (!isUs) {
    return next;
  }
  next.shipping_waived = waived;
  next.shipping_original_minor = minorOf(charge.original_amount);
  next.company_cost = waived
    ? {
      amount: charge.original_amount,
      currency: String(currency || 'USD').toUpperCase(),
      source: shipping.source || null
    }
    : null;
  if (waived) {
    next.cost = 0;
    next.total = 0;
    next.tax_total = 0;
  }
  return next;
}

// The shipping of a plan edit (customer-shipping-charge): it follows the condition the subscription was checked out
// with, never the current switch. A waived US subscription stays at 0 with the edit's quote kept as company cost;
// a charged one, or one created before this rule, is priced with the edit's quote as before.
function editShipping(storedShipping = {}, shipping = {}) {
  const stored = storedShipping || {};
  if (!isShippingWaived(stored.shipping_waived)) {
    return shipping;
  }
  const quote = Number(shipping.cost || shipping.total || 0) || Number(shipping.original_amount || 0);
  const original = amountOf(quote);
  return {
    ...shipping,
    cost: 0,
    total: 0,
    tax_total: 0,
    original_amount: original,
    charged_amount: 0,
    charge_enabled: false,
    shipping_waived: true,
    shipping_original_minor: minorOf(original),
    company_cost: {
      amount: original,
      currency: (stored.company_cost && stored.company_cost.currency) || 'USD',
      source: shipping.source || (stored.company_cost && stored.company_cost.source) || null
    }
  };
}

module.exports = {
  checkoutShipping,
  editShipping,
  customerShipping,
  isShippingWaived
};
