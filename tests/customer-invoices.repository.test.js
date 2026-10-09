const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { CreateCustomerInvoices1700000000029 } = require('../src/infrastructure/migrations/1700000000029-create-customer-invoices');
const { CustomerInvoicesRepository, emailBackoffMs } = require('../src/infrastructure/repositories/customer-invoices.repository');
const { LocalInvoiceStorage } = require('../src/infrastructure/storage/local-invoice-storage');

function queryRunner(hasTable = false) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    createTable: jest.fn().mockResolvedValue(undefined),
    createIndex: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined)
  };
}

describe('CreateCustomerInvoices1700000000029', () => {
  test('creates the sequence table and the invoice table with its unique keys', async () => {
    const runner = queryRunner();
    await new CreateCustomerInvoices1700000000029().up(runner);

    const [sequences] = runner.createTable.mock.calls[0];
    const [invoices] = runner.createTable.mock.calls[1];
    expect(sequences.name).toBe('customer_invoice_sequences');
    expect(invoices.name).toBe('customer_invoices');
    expect(invoices.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'invoice_number', 'stripe_account', 'stripe_invoice_id', 'pdf_filename', 'pdf_sha256',
      'customer_name', 'email_to', 'email_status', 'email_sent_at', 'email_attempts', 'email_next_attempt_at'
    ]));
    expect(runner.createIndex.mock.calls.map(([, index]) => [index.columnNames, Boolean(index.isUnique)])).toEqual([
      [['invoice_number'], true],
      [['stripe_account', 'stripe_invoice_id'], true],
      [['stripe_subscription_id'], false],
      [['email_status', 'email_next_attempt_at'], false]
    ]);
  });

  test('existing tables are left alone; down drops both', async () => {
    const runner = queryRunner(true);
    await new CreateCustomerInvoices1700000000029().up(runner);
    expect(runner.createTable).not.toHaveBeenCalled();
    await new CreateCustomerInvoices1700000000029().down(runner);
    expect(runner.dropTable.mock.calls.map(([name]) => name)).toEqual(['customer_invoices', 'customer_invoice_sequences']);
  });
});

describe('CustomerInvoicesRepository', () => {
  test('reads the yearly sequence on the same connection that raised it', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn()
        .mockResolvedValueOnce({ affectedRows: 2 })
        .mockResolvedValueOnce([{ value: 419 }])
    };
    const repository = new CustomerInvoicesRepository({ createQueryRunner: () => runner });

    await expect(repository.nextSequence(2026)).resolves.toBe(419);
    expect(runner.query.mock.calls[0][0]).toContain('LAST_INSERT_ID(`last_value` + 1)');
    expect(runner.query.mock.calls[0][1]).toEqual([2026]);
    expect(runner.release).toHaveBeenCalled();
  });

  test('maps Stripe prices to the flavor and weight of the catalog variation', async () => {
    const dataSource = {
      query: jest.fn()
        .mockResolvedValueOnce([
          { post_id: 301, meta_value: 'price_beef' },
          { post_id: 302, meta_value: '{"brl":"price_fish"}' }
        ])
        .mockResolvedValueOnce([
          { post_id: 301, meta_key: 'attribute_pa_flavor', meta_value: 'Bovino' },
          { post_id: 301, meta_key: 'attribute_pa_weight', meta_value: '300g' },
          { post_id: 302, meta_key: '_flavor_slug', meta_value: 'fish' },
          { post_id: 302, meta_key: 'attribute_pa_weight', meta_value: '500g' }
        ])
    };
    const repository = new CustomerInvoicesRepository(dataSource);

    const variants = await repository.findVariantsByPriceIds(['price_beef', 'price_fish', 'not_a_price']);

    expect(variants.get('price_beef')).toEqual({ flavorKey: 'beef', grams: 300 });
    expect(variants.get('price_fish')).toEqual({ flavorKey: 'fish', grams: 500 });
  });

  test('email retries back off from five minutes up to six hours', () => {
    expect(emailBackoffMs(1)).toBe(5 * 60 * 1000);
    expect(emailBackoffMs(2)).toBe(10 * 60 * 1000);
    expect(emailBackoffMs(20)).toBe(6 * 60 * 60 * 1000);
  });
});

describe('LocalInvoiceStorage', () => {
  test('writes one file per invoice number and reads it back; other names are refused', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eden-invoices-'));
    const storage = new LocalInvoiceStorage({ directory });

    const filename = await storage.write({ invoiceNumber: 'EB-2026-000418', buffer: Buffer.from('%PDF-1') });
    await storage.write({ invoiceNumber: 'EB-2026-000418', buffer: Buffer.from('%PDF-2') });

    expect(filename).toBe('EB-2026-000418.pdf');
    await expect(storage.read(filename)).resolves.toEqual(Buffer.from('%PDF-2'));
    await expect(storage.read('../etc/passwd')).resolves.toBeNull();
    expect(await fs.readdir(directory)).toEqual(['EB-2026-000418.pdf']);
    await fs.rm(directory, { recursive: true, force: true });
  });
});
