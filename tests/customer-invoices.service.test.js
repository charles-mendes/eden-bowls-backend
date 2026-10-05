const { CustomerInvoicesService } = require('../src/services/customer-invoices.service');
const { PREVIEW_CASES } = require('../src/core/invoice/preview-fixtures');

const NOW = new Date('2026-09-01T16:00:00Z');

function memoryRepository() {
  const rows = new Map();
  let nextId = 1;
  let sequence = 417;
  const update = (id, patch) => {
    const row = { ...rows.get(id), ...patch };
    rows.set(id, row);
    return row;
  };
  return {
    rows,
    nextSequence: jest.fn(async () => { sequence += 1; return sequence; }),
    findById: jest.fn(async (id) => (rows.has(id) ? { ...rows.get(id) } : null)),
    findByStripeInvoice: jest.fn(async (account, invoiceId) => {
      const found = [...rows.values()].find((row) => row.stripeAccount === account && row.stripeInvoiceId === invoiceId);
      return found ? { ...found } : null;
    }),
    listBySubscription: jest.fn(async (subscriptionId) => [...rows.values()].filter((row) => row.stripeSubscriptionId === subscriptionId)),
    insertOrGet: jest.fn(async (input) => {
      const id = nextId;
      nextId += 1;
      rows.set(id, {
        id,
        ...input,
        issuedAt: input.issuedAt.toISOString(),
        pdfFilename: null,
        emailStatus: 'pending',
        emailAttempts: 0
      });
      return { row: { ...rows.get(id) }, created: true };
    }),
    markPdf: jest.fn(async (id, { filename, invoiceStatus, amountPaidMinor }) => update(id, { pdfFilename: filename, invoiceStatus, amountPaidMinor })),
    markEmailSent: jest.fn(async (id, { to, sentAt }) => update(id, { emailStatus: 'sent', emailTo: to, emailSentAt: sentAt.toISOString() })),
    markEmailSkipped: jest.fn(async (id, { to }) => update(id, { emailStatus: 'skipped', emailTo: to })),
    markEmailFailed: jest.fn(async (id, { error }) => update(id, { emailStatus: 'failed', emailLastError: error })),
    listEmailDue: jest.fn(async () => [...rows.values()].filter((row) => row.emailStatus === 'pending' || row.emailStatus === 'failed')),
    findVariantsByPriceIds: jest.fn(async () => PREVIEW_CASES['en-US'].variants)
  };
}

function buildService(overrides = {}) {
  const sample = PREVIEW_CASES['en-US'];
  const invoice = overrides.invoice || sample.invoice('paid');
  const repository = overrides.repository || memoryRepository();
  const files = new Map();
  const storage = {
    write: jest.fn(async ({ invoiceNumber, buffer }) => { files.set(`${invoiceNumber}.pdf`, buffer); return `${invoiceNumber}.pdf`; }),
    read: jest.fn(async (filename) => files.get(filename) || null)
  };
  const billing = { retrieveInvoiceWithLines: jest.fn().mockResolvedValue(invoice) };
  const mailer = overrides.mailer || { sendMail: jest.fn().mockResolvedValue({ skipped: false }) };
  const ledger = {
    id: 9,
    userId: 7,
    stripeAccount: 'us',
    stripeSubscriptionId: 'sub_preview',
    ...sample.ledger
  };
  const ledgerRepository = {
    findByStripeSubscriptionId: jest.fn().mockResolvedValue(ledger),
    findById: jest.fn().mockResolvedValue(ledger)
  };
  const service = new CustomerInvoicesService({
    repository,
    storage,
    renderPdf: overrides.renderPdf || jest.fn().mockResolvedValue(Buffer.from('%PDF-1.3 test')),
    mailer,
    ledgerRepository,
    stripeBilling: billing,
    storeAppUrl: 'https://edenbowls.com',
    now: () => NOW
  });
  return { service, repository, storage, billing, mailer, files, ledgerRepository };
}

describe('CustomerInvoicesService.issueForInvoice', () => {
  test('numbers, renders, stores and emails a paid invoice with the PDF attached', async () => {
    const { service, repository, storage, mailer } = buildService();

    const { row, created } = await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });

    expect(created).toBe(true);
    expect(repository.nextSequence).toHaveBeenCalledWith(2026);
    expect(row).toMatchObject({
      invoiceNumber: 'EB-2026-000418',
      stripeInvoiceId: 'in_preview_us',
      stripeSubscriptionId: 'sub_preview',
      userId: 7,
      locale: 'en-US',
      totalMinor: 14450,
      invoiceStatus: 'paid',
      pdfFilename: 'EB-2026-000418.pdf',
      emailStatus: 'sent',
      emailTo: 'ana@example.com',
      emailSentAt: NOW.toISOString()
    });
    expect(storage.write).toHaveBeenCalledWith({ invoiceNumber: 'EB-2026-000418', buffer: expect.any(Buffer) });
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ana@example.com',
      subject: 'Your Eden Bowls invoice EB-2026-000418',
      attachments: [{ filename: 'EB-2026-000418.pdf', content: expect.any(Buffer), contentType: 'application/pdf' }]
    }));
    expect(mailer.sendMail.mock.calls[0][0].text).toContain('Hi Ana,');
  });

  test('a repeated invoice.paid keeps the number and does not email twice', async () => {
    const { service, repository, mailer, storage } = buildService();

    await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });
    const again = await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });

    expect(again.created).toBe(false);
    expect(again.row.invoiceNumber).toBe('EB-2026-000418');
    expect(repository.nextSequence).toHaveBeenCalledTimes(1);
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  });

  test('an invoice issued open is written again as paid under the same number', async () => {
    const open = PREVIEW_CASES['en-US'].invoice('open');
    const { service, billing, storage, repository } = buildService({ invoice: open });
    await service.issueForInvoice({ invoice: { id: open.id }, account: 'us', send: false });

    billing.retrieveInvoiceWithLines.mockResolvedValue(PREVIEW_CASES['en-US'].invoice('paid'));
    const { row } = await service.issueForInvoice({ invoice: { id: open.id }, account: 'us', send: false });

    expect(repository.nextSequence).toHaveBeenCalledTimes(1);
    expect(storage.write).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({ invoiceNumber: 'EB-2026-000418', invoiceStatus: 'paid', emailStatus: 'pending' });
  });

  test.each([
    ['a $0 invoice', { total: 0 }, 'zero_total'],
    ['a draft invoice', { status: 'draft' }, 'status_not_issuable'],
    ['a void invoice', { status: 'void' }, 'status_not_issuable']
  ])('%s is not issued', async (_label, patch, reason) => {
    const invoice = { ...PREVIEW_CASES['en-US'].invoice('paid'), ...patch };
    const { service, repository } = buildService({ invoice });

    await expect(service.issueForInvoice({ invoice: { id: invoice.id }, account: 'us' }))
      .resolves.toEqual({ skipped: true, reason });
    expect(repository.nextSequence).not.toHaveBeenCalled();
  });

  test('a Brazilian invoice is numbered in Portuguese and emailed in Portuguese', async () => {
    const sample = PREVIEW_CASES['pt-BR'];
    const { service, ledgerRepository, mailer } = buildService({ invoice: sample.invoice('paid') });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({ ...sample.ledger, stripeAccount: 'br', userId: 3 });

    const { row } = await service.issueForInvoice({ invoice: { id: 'in_preview_br' }, account: 'br' });

    expect(row).toMatchObject({ locale: 'pt-BR', stripeAccount: 'br', currency: 'brl' });
    expect(mailer.sendMail.mock.calls[0][0].subject).toBe('Sua fatura Eden Bowls EB-2026-000418');
  });

  test('a disk failure throws so the webhook retries, and the reserved number is kept for that retry', async () => {
    const { service, storage, repository } = buildService();
    storage.write.mockRejectedValueOnce(new Error('ENOSPC'));

    await expect(service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' })).rejects.toThrow('ENOSPC');
    const { row } = await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });

    expect(repository.nextSequence).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ invoiceNumber: 'EB-2026-000418', emailStatus: 'sent' });
  });
});

describe('CustomerInvoicesService email', () => {
  test('an SMTP failure is recorded as failed and not thrown', async () => {
    const mailer = { sendMail: jest.fn().mockRejectedValue(new Error('connection refused')) };
    const { service } = buildService({ mailer });

    const { row } = await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });

    expect(row).toMatchObject({ emailStatus: 'failed', emailLastError: 'connection refused' });
    expect(row.emailSentAt).toBeUndefined();
  });

  test('without SMTP configured nothing is marked as sent', async () => {
    const mailer = { sendMail: jest.fn().mockResolvedValue({ skipped: true }) };
    const { service } = buildService({ mailer });

    const { row } = await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });

    expect(row.emailStatus).toBe('skipped');
    expect(row.emailSentAt).toBeUndefined();
  });

  test('the job sends what is still owed and writes a missing PDF again from Stripe first', async () => {
    const mailer = { sendMail: jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({}) };
    const { service, files, billing } = buildService({ mailer });
    await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });
    files.clear();

    await expect(service.sendDueEmails()).resolves.toEqual({ scanned: 1, sent: 1 });
    expect(billing.retrieveInvoiceWithLines).toHaveBeenCalledTimes(2);
  });
});

describe('CustomerInvoicesService admin', () => {
  const brOperator = { roles: ['operator'], markets: ['BR'], permissions: ['market.br'] };

  test('lists the invoices of a subscription with the send status and date', async () => {
    const { service } = buildService();
    await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });

    const result = await service.listForSubscription(9, {});

    expect(result.data.items).toEqual([expect.objectContaining({
      invoice_number: 'EB-2026-000418',
      pdf_available: true,
      email_status: 'sent',
      email_to: 'ana@example.com',
      email_sent_at: NOW.toISOString()
    })]);
  });

  test('an operator of another market cannot list, download or resend', async () => {
    const { service } = buildService();
    const { row } = await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });

    await expect(service.listForSubscription(9, brOperator)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.downloadPdf(row.id, brOperator)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.resendEmail(row.id, brOperator)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('downloads the stored PDF and resends it, recording a new send date', async () => {
    const { service, mailer } = buildService();
    const { row } = await service.issueForInvoice({ invoice: { id: 'in_preview_us' }, account: 'us' });

    await expect(service.downloadPdf(row.id, {})).resolves.toMatchObject({
      binary: true,
      contentType: 'application/pdf',
      filename: 'EB-2026-000418.pdf'
    });
    const resent = await service.resendEmail(row.id, {});

    expect(resent).toMatchObject({ success: true, data: { email_status: 'sent' } });
    expect(mailer.sendMail).toHaveBeenCalledTimes(2);
  });

  test('issues an older Stripe invoice of the subscription without emailing it', async () => {
    const { service, mailer } = buildService();

    const result = await service.issueFromAdmin(9, 'in_preview_us', {});

    expect(result.data).toMatchObject({ invoice_number: 'EB-2026-000418', email_status: 'pending' });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  test('refuses a Stripe invoice of another subscription', async () => {
    const { service, billing } = buildService();
    billing.retrieveInvoiceWithLines.mockResolvedValue({
      ...PREVIEW_CASES['en-US'].invoice('paid'),
      parent: { subscription_details: { subscription: 'sub_other' } }
    });

    await expect(service.issueFromAdmin(9, 'in_preview_us', {})).rejects.toMatchObject({ statusCode: 404 });
  });
});
