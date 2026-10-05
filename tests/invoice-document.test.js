const { buildInvoiceDocument, formatServicePeriod, formatInvoiceMoney } = require('../src/core/invoice/invoice-document');
const { formatInvoiceNumber, invoiceYear } = require('../src/core/invoice/invoice-number');
const { PREVIEW_CASES, sampleInvoice } = require('../src/core/invoice/preview-fixtures');

function build(locale, status = 'open', overrides = {}) {
  const sample = PREVIEW_CASES[locale];
  return buildInvoiceDocument({
    invoice: { ...sample.invoice(status), ...(overrides.invoice || {}) },
    invoiceNumber: 'EB-2026-000418',
    stripeAccount: sample.stripeAccount,
    ledger: overrides.ledger || sample.ledger,
    variants: overrides.variants || sample.variants
  });
}

describe('invoice document (approved layout texts)', () => {
  test('English invoice due prints the approved texts', () => {
    const model = build('en-US');

    expect(model.pageSize).toBe('LETTER');
    expect(model.title).toBe('INVOICE');
    expect(model.numberLine).toBe('Invoice number EB-2026-000418');
    expect(model.statusLabel).toBe('PAYMENT DUE');
    expect(model.meta).toEqual([
      { label: 'DATE OF ISSUE', value: 'September 1, 2026' },
      { label: 'DATE DUE', value: 'September 1, 2026' }
    ]);
    expect(model.billTo).toEqual({
      label: 'BILL TO',
      lines: ['Ana Mendes', '1200 Ocean Drive, Apt 4B', 'Miami, FL 33139', 'United States', 'ana@example.com']
    });
    expect(model.shipTo.lines).toEqual(['Ana Mendes', '1200 Ocean Drive, Apt 4B', 'Miami, FL 33139', 'United States']);
    expect(model.summary).toEqual({ headline: '$144.50 due September 1, 2026', from: 'From: Eden Bowls' });
    expect(model.payOnline).toEqual({ label: 'PAY ONLINE', url: 'https://invoice.stripe.com/i/preview' });
    expect(model.items).toEqual([
      { description: 'Fresh Bowl · Beef Recipe 10.6 oz', period: 'Service period: Sep 1 to Oct 1, 2026', quantity: '2', unitPrice: '$35.00', amount: '$70.00' },
      { description: 'Fresh Bowl · Chicken Recipe 10.6 oz', period: 'Service period: Sep 1 to Oct 1, 2026', quantity: '3', unitPrice: '$22.50', amount: '$67.50' }
    ]);
    expect(model.totals).toEqual([
      { label: 'Subtotal', value: '$137.50' },
      { label: 'Shipping', value: '$7.00' },
      { label: 'Tax', value: '$0.00' },
      { label: 'Total', value: '$144.50', kind: 'total' },
      { label: 'Amount paid', value: '$0.00' },
      { label: 'Amount due', value: '$144.50', kind: 'due' }
    ]);
    expect(model.notes.text).toBe('Thank you for feeding Luna with Eden Bowls. This invoice covers the subscription cycle shown above. Payment is charged automatically to the card on file.');
    expect(model.footer.issuerLine).toBe('Eden Bowls · Boca Raton, FL, USA');
    expect(model.footer.questionsPrefix).toBe('Questions about this invoice? Write to');
    expect(model.footer.pageLabel(1, 1)).toBe('Page 1 of 1');
  });

  test('Portuguese invoice due prints the approved texts', () => {
    const model = build('pt-BR');

    expect(model.pageSize).toBe('A4');
    expect(model.title).toBe('FATURA');
    expect(model.numberLine).toBe('Número da fatura EB-2026-000418');
    expect(model.statusLabel).toBe('PAGAMENTO PENDENTE');
    expect(model.meta).toEqual([
      { label: 'DATA DE EMISSÃO', value: '1 de setembro de 2026' },
      { label: 'VENCIMENTO', value: '1 de setembro de 2026' }
    ]);
    expect(model.billTo.lines).toEqual([
      'Ana Mendes', 'Rua Aristeu de Castro Fernandes, 120', 'Pinhais, PR · 83331-160', 'Brasil', 'ana@example.com'
    ]);
    expect(model.shipTo.label).toBe('ENTREGA');
    expect(model.summary).toEqual({ headline: 'R$ 144,50 · vence em 1 de setembro de 2026', from: 'Emitente: Eden Bowls' });
    expect(model.payOnline.label).toBe('PAGAR ONLINE');
    expect(model.columns).toEqual({ description: 'DESCRIÇÃO', quantity: 'QTD.', unitPrice: 'PREÇO UNITÁRIO', amount: 'VALOR' });
    expect(model.items[0]).toEqual({
      description: 'Fresh Bowl · Receita de Peixe 300 g',
      period: 'Período: 1 set a 1 out 2026',
      quantity: '2',
      unitPrice: 'R$ 35,00',
      amount: 'R$ 70,00'
    });
    expect(model.totals.map((row) => `${row.label} ${row.value}`)).toEqual([
      'Subtotal R$ 137,50', 'Frete R$ 7,00', 'Impostos R$ 0,00', 'Total R$ 144,50', 'Valor pago R$ 0,00', 'Valor a pagar R$ 144,50'
    ]);
    expect(model.notes.label).toBe('OBSERVAÇÕES');
    expect(model.footer.issuerLine).toBe('Eden Bowls · CNPJ 65.291.985/0001-05 · Curitiba, PR');
    expect(model.footer.pageLabel(1, 1)).toBe('Página 1 de 1');
  });

  test('a paid invoice shows PAID, the payment date, nothing left to pay and no pay button', () => {
    const en = build('en-US', 'paid');
    const pt = build('pt-BR', 'paid');

    expect(en.status).toBe('paid');
    expect(en.statusLabel).toBe('PAID');
    expect(en.meta[1]).toEqual({ label: 'DATE PAID', value: 'September 1, 2026' });
    expect(en.summary.headline).toBe('$144.50 paid September 1, 2026');
    expect(en.payOnline).toBeNull();
    expect(en.totals.slice(-2)).toEqual([
      { label: 'Amount paid', value: '$144.50' },
      { label: 'Amount due', value: '$0.00', kind: 'due' }
    ]);
    expect(en.notes.text).toContain('Payment was charged automatically to the card on file.');
    expect(pt.statusLabel).toBe('PAGO');
    expect(pt.summary.headline).toBe('R$ 144,50 · pago em 1 de setembro de 2026');
  });

  test('a discount, sales tax and an applied credit get their own rows', () => {
    const model = build('en-US', 'paid', {
      invoice: {
        total_discount_amounts: [{ amount: 1375, discount: 'di_1' }],
        total_taxes: [{ amount: 820 }],
        total: 13895,
        amount_due: 12895,
        amount_paid: 12895,
        amount_remaining: 0
      }
    });

    expect(model.totals.map((row) => `${row.label} ${row.value}`)).toEqual([
      'Subtotal $137.50',
      'Discount −$13.75',
      'Shipping $7.00',
      'Tax $8.20',
      'Total $138.95',
      'Credit applied −$10.00',
      'Amount paid $128.95',
      'Amount due $0.00'
    ]);
  });

  test('an unmapped price keeps the Stripe line description; several pets are named together', () => {
    const model = build('pt-BR', 'paid', {
      variants: new Map(),
      ledger: { ...PREVIEW_CASES['pt-BR'].ledger, petsSnapshot: { pets_names: ['Luna', 'Thor', 'Mel'] } }
    });

    expect(model.items[0].description).toBe('2 × Stripe product name');
    expect(model.notes.text.startsWith('Obrigado por alimentar Luna, Thor e Mel com a Eden Bowls.')).toBe(true);
  });

  test('a plan change invoice says so; without a pet name the thanks stays generic', () => {
    const model = build('en-US', 'paid', {
      invoice: { billing_reason: 'subscription_update' },
      ledger: { ...PREVIEW_CASES['en-US'].ledger, petsSnapshot: null }
    });

    expect(model.notes.text).toBe('Thank you for choosing Eden Bowls. This invoice covers the plan change shown above. Payment was charged automatically to the card on file.');
  });

  test('without a ledger address the Stripe customer address is used', () => {
    const invoice = {
      ...sampleInvoice({ currency: 'usd', status: 'paid' }),
      customer_address: { line1: '5 Main St', city: 'Boca Raton', state: 'FL', postal_code: '33431', country: 'US' }
    };
    const model = buildInvoiceDocument({ invoice, invoiceNumber: 'EB-2026-000001', stripeAccount: 'us', ledger: {} });

    expect(model.shipTo.lines).toEqual(['Ana Mendes', '5 Main St', 'Boca Raton, FL 33431', 'United States']);
  });
});

describe('invoice formatting helpers', () => {
  test('a service period across two years repeats the year on both ends', () => {
    const dec = Date.UTC(2026, 11, 1, 15) / 1000;
    const jan = Date.UTC(2027, 0, 1, 15) / 1000;
    expect(formatServicePeriod(dec, jan, 'en-US')).toBe('Dec 1, 2026 to Jan 1, 2027');
    expect(formatServicePeriod(dec, jan, 'pt-BR')).toBe('1 dez 2026 a 1 jan 2027');
  });

  test('money uses the market format with thousands separators', () => {
    expect(formatInvoiceMoney(123450, 'usd', 'en-US')).toBe('$1,234.50');
    expect(formatInvoiceMoney(123450, 'brl', 'pt-BR')).toBe('R$ 1.234,50');
  });

  test('invoice numbers are EB-year-six digits, the year taken in the market timezone', () => {
    expect(formatInvoiceNumber(2026, 418)).toBe('EB-2026-000418');
    // 2027-01-01 01:00 UTC is still 2026 in New York and in São Paulo.
    const newYearUtc = Date.UTC(2027, 0, 1, 1) / 1000;
    expect(invoiceYear(newYearUtc, 'en-US')).toBe(2026);
    expect(invoiceYear(newYearUtc, 'pt-BR')).toBe(2026);
  });
});
