const { DataSource } = require('typeorm');
const { CreateCustomerInvoices1700000000029 } = require('../../src/infrastructure/migrations/1700000000029-create-customer-invoices');
const { AddInvoiceIssuerSnapshot1700000000051 } = require('../../src/infrastructure/migrations/1700000000051-add-invoice-issuer-snapshot');
const { CustomerInvoicesRepository } = require('../../src/infrastructure/repositories/customer-invoices.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

function connection(database) {
  return new DataSource({
    type: 'mysql',
    host: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
    port: Number(process.env.INTEGRATION_DB_PORT || 3310),
    username: process.env.INTEGRATION_DB_USER || 'root',
    password: process.env.INTEGRATION_DB_PASSWORD || 'root',
    database,
    charset: 'utf8mb4',
    timezone: 'Z',
    entities: [],
    migrations: [],
    synchronize: false,
    logging: false,
    extra: { connectionLimit: 10 }
  });
}

function invoiceInput(stripeInvoiceId, invoiceNumber) {
  return {
    invoiceNumber,
    stripeAccount: 'us',
    stripeInvoiceId,
    stripeSubscriptionId: 'sub_it',
    userId: 7,
    locale: 'en-US',
    currency: 'usd',
    totalMinor: 14450,
    amountPaidMinor: 14450,
    invoiceStatus: 'paid',
    billingReason: 'subscription_cycle',
    issuedAt: new Date('2026-09-01T15:00:00Z'),
    customerName: 'Ana Mendes',
    emailTo: 'ana@example.com'
  };
}

describeIntegration('customer invoices (MySQL)', () => {
  const database = `it_invoices_${Date.now()}`;
  const admin = connection(process.env.INTEGRATION_DB_NAME || 'eden_bowls');
  const dataSource = connection(database);
  let repository;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateCustomerInvoices1700000000029().up(runner);
    // Two invoices numbered before the issuer snapshot existed.
    await dataSource.query(`INSERT INTO customer_invoices
      (invoice_number, stripe_account, stripe_invoice_id, locale, currency, invoice_status, issued_at, email_status)
      VALUES ('EB-2026-800001', 'br', 'in_legacy_br', 'pt-BR', 'brl', 'paid', '2026-08-01 12:00:00', 'sent'),
             ('EB-2026-800002', 'us', 'in_legacy_us', 'en-US', 'usd', 'paid', '2026-08-01 12:00:00', 'sent')`);
    await new AddInvoiceIssuerSnapshot1700000000051().up(runner);
    await runner.release();
    repository = new CustomerInvoicesRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('twenty simultaneous numbers of one year are all different and gap free; a new year starts at 1', async () => {
    const values = await Promise.all(Array.from({ length: 20 }, () => repository.nextSequence(2026)));

    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    await expect(repository.nextSequence(2027)).resolves.toBe(1);
  });

  test('the same Stripe invoice is stored once; the second insert gets the first row back', async () => {
    const first = await repository.insertOrGet(invoiceInput('in_it_1', 'EB-2026-900001'));
    const second = await repository.insertOrGet(invoiceInput('in_it_1', 'EB-2026-900002'));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.row).toMatchObject({ id: first.row.id, invoiceNumber: 'EB-2026-900001', emailStatus: 'pending' });
  });

  test('records the PDF, a failed send with its retry time, then the send date', async () => {
    const { row } = await repository.insertOrGet(invoiceInput('in_it_2', 'EB-2026-900003'));
    const now = new Date('2026-09-01T16:00:00Z');

    await repository.markPdf(row.id, { filename: 'EB-2026-900003.pdf', sha256: 'a'.repeat(64), generatedAt: now, invoiceStatus: 'paid' });
    const failed = await repository.markEmailFailed(row.id, { error: 'timeout', now, maxAttempts: 8 });
    const due = await repository.listEmailDue({ now: new Date(now.getTime() + 6 * 60 * 1000) });
    const sent = await repository.markEmailSent(row.id, { to: 'ana@example.com', sentAt: now });

    expect(failed).toMatchObject({ emailStatus: 'failed', emailAttempts: 1, emailNextAttemptAt: '2026-09-01T16:05:00.000Z' });
    expect(due.map((item) => item.id)).toContain(row.id);
    expect(sent).toMatchObject({
      pdfFilename: 'EB-2026-900003.pdf',
      emailStatus: 'sent',
      emailSentAt: '2026-09-01T16:00:00.000Z',
      emailAttempts: 2,
      emailLastError: null
    });
    await expect(repository.listBySubscription('sub_it')).resolves.toHaveLength(2);
  });

  test('the deploy stores on every invoice already issued the issuer it printed', async () => {
    const br = await repository.findByStripeInvoice('br', 'in_legacy_br');
    const us = await repository.findByStripeInvoice('us', 'in_legacy_us');
    expect(br.issuerSnapshot).toEqual({ name: 'Eden Bowls', line: 'Eden Bowls · CNPJ 65.291.985/0001-05 · Curitiba, PR', email: 'hello@edenbowls.com' });
    expect(us.issuerSnapshot).toEqual({ name: 'Eden Bowls', line: 'Eden Bowls · Boca Raton, FL, USA', email: 'hello@edenbowls.com' });
    const [{ missing }] = await dataSource.query("SELECT COUNT(*) AS missing FROM customer_invoices WHERE issuer_snapshot IS NULL AND invoice_number LIKE 'EB-2026-8%'");
    expect(Number(missing)).toBe(0);
  });

  test('a stored snapshot is never replaced', async () => {
    const issuer = { name: 'Eden Bowls', line: 'Eden Bowls · CNPJ 65.291.985/0001-05 · Curitiba, PR', email: 'hello@edenbowls.com' };
    const { row } = await repository.insertOrGet({ ...invoiceInput('in_it_3', 'EB-2026-900004'), issuerSnapshot: issuer });
    await repository.setIssuerSnapshot(row.id, { ...issuer, line: 'Eden Bowls · CNPJ 65.291.985/0001-05 · São Paulo, SP' });
    expect((await repository.findById(row.id)).issuerSnapshot).toEqual(issuer);
  });
});
