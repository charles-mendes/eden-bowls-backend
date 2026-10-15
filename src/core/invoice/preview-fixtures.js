// The sample data of the approved layout, shaped like a Stripe invoice (API 2025-09-30.clover) and a ledger row.
// Used by src/scripts/render-invoice-previews.js and by the invoice tests.

const SEPT_1 = Math.floor(Date.UTC(2026, 8, 1, 15) / 1000);
const OCT_1 = Math.floor(Date.UTC(2026, 9, 1, 15) / 1000);

function recipeLine(id, priceId, quantity, unitAmount, currency) {
  return {
    id,
    amount: quantity * unitAmount,
    currency,
    description: `${quantity} × Stripe product name`,
    quantity,
    period: { start: SEPT_1, end: OCT_1 },
    pricing: {
      type: 'price_details',
      price_details: { price: priceId, product: 'prod_recipe' },
      unit_amount_decimal: String(unitAmount)
    }
  };
}

function shippingLine(currency) {
  return {
    id: 'il_shipping',
    amount: 700,
    currency,
    description: 'Shipping',
    quantity: 1,
    period: { start: SEPT_1, end: SEPT_1 },
    pricing: {
      type: 'price_details',
      price_details: { price: 'price_shipping', product: 'prod_shipping' },
      unit_amount_decimal: '700'
    }
  };
}

function sampleInvoice({ currency, status = 'open', customerName = 'Ana Mendes' }) {
  const paid = status === 'paid';
  return {
    id: currency === 'brl' ? 'in_preview_br' : 'in_preview_us',
    object: 'invoice',
    status,
    currency,
    billing_reason: 'subscription_cycle',
    created: SEPT_1,
    due_date: null,
    status_transitions: { finalized_at: SEPT_1, paid_at: paid ? SEPT_1 : null },
    customer_name: customerName,
    customer_email: 'ana@example.com',
    hosted_invoice_url: 'https://invoice.stripe.com/i/preview',
    subtotal: 14450,
    total: 14450,
    total_taxes: [],
    total_discount_amounts: [],
    amount_due: 14450,
    amount_paid: paid ? 14450 : 0,
    amount_remaining: paid ? 0 : 14450,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: 'sub_preview', metadata: { shipping_product_id: 'prod_shipping' } }
    },
    lines: {
      data: [
        recipeLine('il_1', 'price_first', 2, 3500, currency),
        recipeLine('il_2', 'price_second', 3, 2250, currency),
        shippingLine(currency)
      ],
      has_more: false
    }
  };
}

const PREVIEW_CASES = {
  'en-US': {
    stripeAccount: 'us',
    invoice: (status) => sampleInvoice({ currency: 'usd', status }),
    ledger: {
      customerEmail: 'ana@example.com',
      address: {
        country: 'US',
        street: '1200 Ocean Drive',
        complement: 'Apt 4B',
        city: 'Miami',
        state: 'FL',
        zipcode: '33139'
      },
      petsSnapshot: { pets_names: ['Luna'] }
    },
    variants: new Map([
      ['price_first', { flavorKey: 'beef', grams: 300 }],
      ['price_second', { flavorKey: 'turkey', grams: 300 }]
    ])
  },
  'pt-BR': {
    stripeAccount: 'br',
    invoice: (status) => sampleInvoice({ currency: 'brl', status }),
    ledger: {
      customerEmail: 'ana@example.com',
      address: {
        country: 'BR',
        street: 'Rua Aristeu de Castro Fernandes',
        number: '120',
        city: 'Pinhais',
        state: 'PR',
        zipcode: '83331160'
      },
      petsSnapshot: { pets_names: ['Luna'] }
    },
    variants: new Map([
      ['price_first', { flavorKey: 'fish', grams: 300 }],
      ['price_second', { flavorKey: 'turkey', grams: 300 }]
    ])
  }
};

module.exports = {
  PREVIEW_CASES,
  sampleInvoice
};
