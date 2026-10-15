// Renders the invoice PDF for the approved sample data, in both languages and both states, so a layout change
// can be compared with docs-new/FEATURE_CUSTOMIZED_INVOICE/Eden Bowls - Invoice personalizado EN e PT (aprovacao).pdf.
// Usage: node src/scripts/render-invoice-previews.js [output-dir]
const fs = require('fs/promises');
const path = require('path');
const { buildInvoiceDocument } = require('../core/invoice/invoice-document');
const { PREVIEW_CASES } = require('../core/invoice/preview-fixtures');
const { renderInvoicePdf } = require('../infrastructure/invoices/invoice-pdf-renderer');

async function main() {
  const outputDir = path.resolve(process.argv[2] || path.join('docs-new', 'FEATURE_CUSTOMIZED_INVOICE', 'previews'));
  await fs.mkdir(outputDir, { recursive: true });
  for (const [locale, sample] of Object.entries(PREVIEW_CASES)) {
    for (const status of ['open', 'paid']) {
      const model = buildInvoiceDocument({
        invoice: sample.invoice(status),
        invoiceNumber: 'EB-2026-000418',
        stripeAccount: sample.stripeAccount,
        ledger: sample.ledger,
        variants: sample.variants
      });
      const file = path.join(outputDir, `invoice-${locale}-${status === 'paid' ? 'paid' : 'due'}.pdf`);
      await fs.writeFile(file, await renderInvoicePdf(model));
      console.log(file);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
