const { DateTime } = require('luxon');
const { parseJsonColumn } = require('../stripe-subscription-map');
const { formatPackSizeLabel } = require('../plan-catalog-pricing');
const { INVOICE_COPY, INVOICE_ISSUERS, FLAVOR_RECIPE_LABELS } = require('./invoice-copy');

const ZONES = { 'pt-BR': 'America/Sao_Paulo', 'en-US': 'America/New_York' };
const COUNTRY_NAMES = {
  'en-US': { US: 'United States', BR: 'Brazil' },
  'pt-BR': { US: 'Estados Unidos', BR: 'Brasil' }
};

function invoiceLocale(stripeAccount, address = {}) {
  const account = String(stripeAccount || '').toLowerCase();
  const country = String(address.country || '').toUpperCase();
  return account === 'br' || country === 'BR' ? 'pt-BR' : 'en-US';
}

function toDateTime(value, locale) {
  const zone = ZONES[locale] || ZONES['en-US'];
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return DateTime.fromMillis(value < 1e12 ? value * 1000 : value, { zone });
  }
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone });
  const parsed = DateTime.fromISO(String(value), { zone });
  return parsed.isValid ? parsed : null;
}

// "September 1, 2026" / "1 de setembro de 2026".
function formatLongDate(value, locale) {
  const date = toDateTime(value, locale);
  if (!date || !date.isValid) return '';
  return locale === 'pt-BR'
    ? date.setLocale('pt-BR').toFormat("d 'de' MMMM 'de' yyyy")
    : date.setLocale('en-US').toFormat('MMMM d, yyyy');
}

// "Sep 1 to Oct 1, 2026" / "1 set a 1 out 2026". The year repeats on both ends only when it changes.
function formatServicePeriod(start, end, locale) {
  const from = toDateTime(start, locale);
  const to = toDateTime(end, locale);
  if (!from || !to || !from.isValid || !to.isValid) return '';
  const sameYear = from.year === to.year;
  if (locale === 'pt-BR') {
    const month = (date) => date.setLocale('pt-BR').toFormat('LLL').replace('.', '');
    const left = `${from.day} ${month(from)}${sameYear ? '' : ` ${from.year}`}`;
    return `${left} a ${to.day} ${month(to)} ${to.year}`;
  }
  const left = from.setLocale('en-US').toFormat(sameYear ? 'LLL d' : 'LLL d, yyyy');
  return `${left} to ${to.setLocale('en-US').toFormat('LLL d, yyyy')}`;
}

// "$1,234.50" / "R$ 1.234,50". Negative amounts keep the sign in front of the symbol.
function formatInvoiceMoney(amountMinor, currency, locale) {
  const code = String(currency || 'usd').toUpperCase();
  const amount = Number(amountMinor || 0) / 100;
  const formatted = new Intl.NumberFormat(locale === 'pt-BR' ? 'pt-BR' : 'en-US', {
    style: 'currency',
    currency: code,
    currencyDisplay: 'symbol'
  }).format(Math.abs(amount)).replace(/ /g, ' ');
  return amount < 0 ? `−${formatted}` : formatted;
}

function formatPostalCode(value, country) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (country === 'BR' && digits.length === 8) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return raw;
}

function pick(...values) {
  for (const value of values) {
    const text = String(value == null ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

// Ledger address (onboarding shape) first; the Stripe customer address is the fallback.
function addressLines(address, locale) {
  const source = address || {};
  const country = pick(source.country).toUpperCase();
  const street = pick(source.street, source.address_line1, source.line1);
  const number = pick(source.number);
  const complement = pick(source.complement, source.address_line2, source.line2);
  const city = pick(source.city);
  const state = pick(source.state);
  const postal = formatPostalCode(pick(source.zipcode, source.postal_code), country);
  const line1 = [[street, number].filter(Boolean).join(', '), complement].filter(Boolean).join(', ');
  const cityLine = country === 'BR'
    ? [[city, state].filter(Boolean).join(', '), postal].filter(Boolean).join(' · ')
    : [[city, state].filter(Boolean).join(', '), postal].filter(Boolean).join(' ');
  const countryName = (COUNTRY_NAMES[locale] || {})[country] || country;
  return [line1, cityLine, countryName].filter(Boolean);
}

function stripeAddress(details) {
  const address = details && details.address ? details.address : null;
  if (!address) return null;
  return {
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postal_code: address.postal_code,
    country: address.country
  };
}

function petNamesFrom(ledger = {}) {
  const snapshot = parseJsonColumn(ledger.petsSnapshot || ledger.pets_snapshot) || {};
  if (Array.isArray(snapshot.pets_names) && snapshot.pets_names.length) {
    return snapshot.pets_names.map(String).filter(Boolean);
  }
  const pets = Array.isArray(snapshot.pets) ? snapshot.pets : [];
  const fromSnapshot = pets.map((pet) => pick(pet && pet.name, pet && pet.pet_name)).filter(Boolean);
  if (fromSnapshot.length) return fromSnapshot;
  const plan = parseJsonColumn(ledger.planSelection || ledger.plan_selection) || {};
  return (Array.isArray(plan.pets) ? plan.pets : [])
    .map((pet) => pick(pet && pet.pet_name, pet && pet.name))
    .filter(Boolean);
}

function joinNames(names, locale) {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] || '';
  const last = unique[unique.length - 1];
  return `${unique.slice(0, -1).join(', ')} ${locale === 'pt-BR' ? 'e' : 'and'} ${last}`;
}

function linePriceId(line) {
  const details = line && line.pricing && line.pricing.price_details;
  if (details && details.price) return typeof details.price === 'string' ? details.price : details.price.id;
  if (line && line.price) return typeof line.price === 'string' ? line.price : line.price.id;
  return '';
}

function lineProductId(line) {
  const details = line && line.pricing && line.pricing.price_details;
  if (details && details.product) return typeof details.product === 'string' ? details.product : details.product.id;
  const price = line && line.price && typeof line.price === 'object' ? line.price : null;
  if (price && price.product) return typeof price.product === 'string' ? price.product : price.product.id;
  return '';
}

function lineUnitMinor(line) {
  const decimal = line && line.pricing ? Number(line.pricing.unit_amount_decimal) : NaN;
  if (Number.isFinite(decimal)) return Math.round(decimal);
  const price = line && line.price && typeof line.price === 'object' ? line.price : null;
  if (price && Number.isFinite(Number(price.unit_amount))) return Number(price.unit_amount);
  const quantity = Math.max(1, Number(line && line.quantity) || 1);
  return Math.round(Number(line && line.amount || 0) / quantity);
}

function sumAmounts(list) {
  return (Array.isArray(list) ? list : []).reduce((total, item) => total + (Number(item && item.amount) || 0), 0);
}

function taxMinor(invoice) {
  if (Array.isArray(invoice.total_taxes)) return sumAmounts(invoice.total_taxes);
  return Number(invoice.tax || 0) || 0;
}

function recipeDescription(variant, locale, country) {
  const copy = FLAVOR_RECIPE_LABELS[locale] || FLAVOR_RECIPE_LABELS['en-US'];
  const recipe = copy[variant.flavorKey];
  if (!recipe) return '';
  const size = variant.grams > 0 ? ` ${formatPackSizeLabel(variant.grams, country)}` : '';
  return `${INVOICE_COPY[locale].productLine} · ${recipe}${size}`;
}

function isShippingLine(line, shippingProductIds) {
  const product = lineProductId(line);
  return Boolean(product && shippingProductIds.has(product));
}

function shippingProductIdsFrom(invoice, extra) {
  const ids = new Set((extra || []).filter(Boolean));
  const meta = invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.metadata
    || invoice.subscription_details && invoice.subscription_details.metadata
    || {};
  if (meta.shipping_product_id) ids.add(String(meta.shipping_product_id));
  return ids;
}

/**
 * Builds every string the invoice PDF prints, in the customer's market language.
 * `invoice` is the Stripe invoice with all its lines; `variants` maps a Stripe price id to
 * `{ flavorKey, grams }` so recipe lines read the same in both languages whatever the Stripe product name is.
 */
function buildInvoiceDocument({
  invoice,
  invoiceNumber,
  stripeAccount,
  ledger = {},
  customer = {},
  variants = new Map(),
  shippingProductIds = []
}) {
  if (!invoice || !invoice.id) throw new Error('A Stripe invoice is required to build the document.');
  const ledgerAddress = parseJsonColumn(ledger.address) || null;
  const fallbackAddress = stripeAddress(invoice.customer_shipping) || stripeAddress({ address: invoice.customer_address });
  const shipTo = ledgerAddress && pick(ledgerAddress.city, ledgerAddress.zipcode) ? ledgerAddress : fallbackAddress || {};
  const locale = invoiceLocale(stripeAccount, shipTo);
  const copy = INVOICE_COPY[locale];
  const issuer = INVOICE_ISSUERS[locale];
  const country = locale === 'pt-BR' ? 'BR' : 'US';
  const currency = String(invoice.currency || (locale === 'pt-BR' ? 'brl' : 'usd')).toLowerCase();
  const money = (value) => formatInvoiceMoney(value, currency, locale);

  const paid = String(invoice.status || '') === 'paid';
  const issuedAt = invoice.status_transitions && invoice.status_transitions.finalized_at || invoice.created;
  const dueAt = invoice.due_date || issuedAt;
  const paidAt = invoice.status_transitions && invoice.status_transitions.paid_at || null;
  const name = pick(invoice.customer_name, customer.name, invoice.customer_shipping && invoice.customer_shipping.name);
  const email = pick(invoice.customer_email, customer.email, ledger.customerEmail);
  const billingAddress = ledgerAddress && pick(ledgerAddress.city, ledgerAddress.zipcode)
    ? ledgerAddress
    : stripeAddress({ address: invoice.customer_address }) || shipTo;

  const shippingIds = shippingProductIdsFrom(invoice, shippingProductIds);
  const allLines = invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  const items = [];
  let itemsMinor = 0;
  let shippingMinor = 0;
  for (const line of allLines) {
    const amount = Number(line.amount || 0) || 0;
    if (isShippingLine(line, shippingIds)) {
      shippingMinor += amount;
      continue;
    }
    itemsMinor += amount;
    const variant = variants.get(linePriceId(line));
    const period = line.period ? formatServicePeriod(line.period.start, line.period.end, locale) : '';
    items.push({
      description: (variant && recipeDescription(variant, locale, country)) || pick(line.description, copy.fallbackLine),
      period: period ? `${copy.servicePeriod}: ${period}` : '',
      quantity: String(Math.max(0, Number(line.quantity) || 0) || 1),
      unitPrice: money(lineUnitMinor(line)),
      amount: money(amount)
    });
  }

  const discountMinor = Array.isArray(invoice.total_discount_amounts) ? sumAmounts(invoice.total_discount_amounts) : 0;
  const total = Number(invoice.total || 0) || 0;
  const amountDue = Number(invoice.amount_due != null ? invoice.amount_due : total) || 0;
  const creditMinor = total - amountDue;
  const amountPaid = Number(invoice.amount_paid || 0) || 0;
  const remaining = invoice.amount_remaining != null ? Number(invoice.amount_remaining) || 0 : Math.max(0, amountDue - amountPaid);

  const totals = [
    { label: copy.subtotal, value: money(itemsMinor) },
    ...(discountMinor > 0 ? [{ label: copy.discount, value: money(-discountMinor) }] : []),
    { label: copy.shipping, value: money(shippingMinor) },
    { label: copy.tax, value: money(taxMinor(invoice)) },
    { label: copy.total, value: money(total), kind: 'total' },
    ...(creditMinor !== 0 ? [{ label: copy.credit, value: money(-creditMinor) }] : []),
    { label: copy.amountPaid, value: money(amountPaid) },
    { label: copy.amountDue, value: money(remaining), kind: 'due' }
  ];

  const pets = joinNames(petNamesFrom(ledger), locale);
  const reason = String(invoice.billing_reason || '');
  const notes = [
    pets ? copy.thanksPet(pets) : copy.thanks,
    reason === 'subscription_update' ? copy.coversChange : copy.coversCycle,
    paid ? copy.chargedPaid : copy.chargedDue
  ].join(' ');

  const headlineDate = formatLongDate(paid ? (paidAt || issuedAt) : dueAt, locale);
  return {
    locale,
    pageSize: locale === 'pt-BR' ? 'A4' : 'LETTER',
    title: copy.title,
    numberLine: `${copy.numberLabel} ${invoiceNumber}`,
    invoiceNumber,
    status: paid ? 'paid' : 'due',
    statusLabel: paid ? copy.statusPaid : copy.statusDue,
    meta: [
      { label: copy.issued, value: formatLongDate(issuedAt, locale) },
      paid
        ? { label: copy.paidOn, value: formatLongDate(paidAt || issuedAt, locale) }
        : { label: copy.due, value: formatLongDate(dueAt, locale) }
    ],
    billTo: { label: copy.billTo, lines: [name, ...addressLines(billingAddress, locale), email].filter(Boolean) },
    shipTo: { label: copy.shipTo, lines: [name, ...addressLines(shipTo, locale)].filter(Boolean) },
    summary: {
      headline: paid ? copy.headlinePaid(money(total), headlineDate) : copy.headlineDue(money(remaining), headlineDate),
      from: `${copy.from}: ${issuer.name}`
    },
    payOnline: !paid && invoice.hosted_invoice_url ? { label: copy.payOnline, url: String(invoice.hosted_invoice_url) } : null,
    columns: copy.columns,
    items,
    totals,
    notes: { label: copy.notes, text: notes },
    footer: {
      issuerLine: issuer.line,
      questionsPrefix: copy.questions,
      email: issuer.email,
      pageLabel: copy.page
    },
    totalMinor: total,
    amountPaidMinor: amountPaid,
    currency
  };
}

module.exports = {
  buildInvoiceDocument,
  formatInvoiceMoney,
  formatLongDate,
  formatServicePeriod,
  invoiceLocale,
  linePriceId
};
