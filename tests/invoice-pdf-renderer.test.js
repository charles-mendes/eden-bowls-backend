const { buildInvoiceDocument } = require('../src/core/invoice/invoice-document');
const { PREVIEW_CASES } = require('../src/core/invoice/preview-fixtures');
const { renderInvoicePdf } = require('../src/infrastructure/invoices/invoice-pdf-renderer');

function model(locale, invoiceOverrides = {}) {
  const sample = PREVIEW_CASES[locale];
  return buildInvoiceDocument({
    invoice: { ...sample.invoice('paid'), ...invoiceOverrides },
    invoiceNumber: 'EB-2026-000418',
    stripeAccount: sample.stripeAccount,
    ledger: sample.ledger,
    variants: sample.variants
  });
}

function pageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
}

describe('renderInvoicePdf', () => {
  test.each([['en-US', [612, 792]], ['pt-BR', [595.28, 841.89]]])('%s renders one page in its paper size', async (locale, size) => {
    const buffer = await renderInvoicePdf(model(locale));

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(buffer)).toBe(1);
    expect(buffer.toString('latin1')).toContain(`/MediaBox [0 0 ${size[0]} ${size[1]}]`);
  });

  test('many lines flow onto more pages', async () => {
    const base = PREVIEW_CASES['en-US'].invoice('paid');
    const lines = Array.from({ length: 30 }, (_, index) => ({ ...base.lines.data[0], id: `il_${index}` }));
    const buffer = await renderInvoicePdf(model('en-US', { lines: { data: lines, has_more: false } }));

    expect(pageCount(buffer)).toBeGreaterThan(1);
  });
});
