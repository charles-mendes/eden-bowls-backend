const { BlingNfeEmailService, MAX_ATTEMPTS } = require('../src/services/bling-nfe-email.service');
const { BlingNfeService } = require('../src/services/bling-nfe.service');
const { buildNfeEmail } = require('../src/core/email/transactional-emails');

const NOW = new Date('2026-11-02T15:00:00.000Z');
const PDF = Buffer.from('%PDF-1.4 danfe');
const XML = '<nfeProc><tpAmb>1</tpAmb></nfeProc>';

function memoryRepository(rows) {
  const store = new Map(rows.map((row) => [row.id, row]));
  return {
    rows: store,
    failStaleEmails: jest.fn(async () => {}),
    listEmailDue: jest.fn(async () => [...store.values()].filter((row) => ['pending', 'failed'].includes(row.emailStatus) && row.emailNextAttemptAt)),
    claimEmail: jest.fn(async (id) => {
      const row = store.get(id);
      if (!['pending', 'failed'].includes(row.emailStatus)) return false;
      row.emailStatus = 'sending';
      row.emailNextAttemptAt = null;
      return true;
    }),
    update: jest.fn(async (id, patch) => Object.assign(store.get(id), patch))
  };
}

const note = (overrides = {}) => ({
  id: 1,
  status: 'authorized',
  blingNfeId: 40,
  nfeNumber: '158',
  nfeSeries: '1',
  accessKey: '35261165291985000105550010000001581000001589',
  customerName: 'Ana Souza',
  customerEmail: 'ana@example.com',
  totalMinor: 19900,
  currency: 'brl',
  authorizedAt: NOW.toISOString(),
  emailStatus: 'pending',
  emailAttempts: 0,
  emailNextAttemptAt: NOW.toISOString(),
  ...overrides
});

function build({ rows = [note()], nfe = {}, sendMail = jest.fn(async () => ({})), enabled = true } = {}) {
  const repository = memoryRepository(rows);
  const client = {
    getNfe: jest.fn(async () => ({ id: 40, situacao: 5, numero: '158', serie: 1, chaveAcesso: rows[0].accessKey, linkPDF: 'https://bling/pdf', xml: 'https://bling/xml', ...nfe })),
    downloadDocument: jest.fn(async (url) => (url.endsWith('pdf') ? PDF : Buffer.from(XML)))
  };
  const service = new BlingNfeEmailService({
    repository,
    client,
    mailer: { sendMail },
    enabled,
    now: () => NOW,
    logger: { error() {}, warn() {}, info() {} }
  });
  return { service, repository, client, sendMail };
}

describe('BlingNfeEmailService', () => {
  test('sends the DANFE and the XML once, to the customer of the note', async () => {
    const { service, repository, sendMail } = build();

    await expect(service.sendDue()).resolves.toEqual({ sent: 1, failed: 0 });
    await expect(service.sendDue()).resolves.toEqual({ sent: 0, failed: 0 });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('ana@example.com');
    expect(mail.subject).toBe('Sua nota fiscal Eden Bowls nº 158');
    expect(mail.attachments.map((file) => file.filename)).toEqual(['DANFE-158.pdf', 'NFe-35261165291985000105550010000001581000001589.xml']);
    expect(repository.rows.get(1)).toMatchObject({ emailStatus: 'sent', emailTo: 'ana@example.com', emailSentAt: NOW, emailNextAttemptAt: null });
  });

  test('two runs racing for a note send one email', async () => {
    const { service, repository, sendMail } = build();
    repository.listEmailDue.mockResolvedValue([note()]);

    await Promise.all([service.sendDue(), service.sendDue()]);

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test('does nothing while turned off', async () => {
    const { service, repository, client } = build({ enabled: false });
    await expect(service.sendDue()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(repository.listEmailDue).not.toHaveBeenCalled();
    expect(client.getNfe).not.toHaveBeenCalled();
  });

  test('does not send a note canceled after the authorization', async () => {
    const { service, repository, sendMail } = build({ nfe: { situacao: 2 } });
    await service.sendDue();
    expect(sendMail).not.toHaveBeenCalled();
    expect(repository.rows.get(1)).toMatchObject({ emailStatus: 'skipped', emailNextAttemptAt: null });
  });

  test('a document Bling cannot give yet is retried later, without an email', async () => {
    const { service, repository, client, sendMail } = build();
    client.downloadDocument.mockRejectedValueOnce(new Error('Bling answered 502 for the document.'));

    await expect(service.sendDue()).resolves.toEqual({ sent: 0, failed: 1 });

    expect(sendMail).not.toHaveBeenCalled();
    expect(repository.rows.get(1)).toMatchObject({ emailStatus: 'failed', emailNextAttemptAt: new Date(NOW.getTime() + 5 * 60 * 1000) });
  });

  test('refuses a page in place of the PDF and accepts an XML that comes inline', async () => {
    const page = build();
    page.client.downloadDocument.mockResolvedValueOnce(Buffer.from('<!DOCTYPE html>'));
    await expect(page.service.sendDue()).resolves.toEqual({ sent: 0, failed: 1 });

    const inline = build({ nfe: { xml: XML } });
    await expect(inline.service.sendDue()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(inline.client.downloadDocument).toHaveBeenCalledTimes(1);
  });

  test('stops after the last attempt', async () => {
    const { service, repository } = build({ rows: [note({ emailStatus: 'failed', emailAttempts: MAX_ATTEMPTS - 1 })], sendMail: jest.fn(async () => { throw new Error('smtp down'); }) });
    await service.sendDue();
    expect(repository.rows.get(1)).toMatchObject({ emailStatus: 'failed', emailNextAttemptAt: null, emailLastError: 'smtp down' });
  });

  test('never retries a timeout, because the message may have been delivered', async () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'timeout' });
    const { service, repository } = build({ sendMail: jest.fn(async () => { throw timeout; }) });
    await service.sendDue();
    expect(repository.rows.get(1).emailStatus).toBe('failed');
    expect(repository.rows.get(1).emailNextAttemptAt).toBeNull();
    expect(repository.rows.get(1).emailLastError).toContain('pode ter sido entregue');
  });

  test('a note without an email is not retried', async () => {
    const { service, repository, sendMail } = build({ rows: [note({ customerEmail: null })] });
    await service.sendDue();
    expect(sendMail).not.toHaveBeenCalled();
    expect(repository.rows.get(1)).toMatchObject({ emailStatus: 'failed', emailNextAttemptAt: null });
  });

  test('a homologation note says so in the subject and the body', async () => {
    const { service, sendMail } = build({ nfe: { xml: '<nfeProc><tpAmb>2</tpAmb></nfeProc>' } });
    await service.sendDue();
    expect(sendMail.mock.calls[0][0].subject).toMatch(/^\[TESTE\]/);
    expect(sendMail.mock.calls[0][0].text).toContain('sem valor fiscal');
  });
});

describe('buildNfeEmail', () => {
  test('carries the note data and no CPF', () => {
    const content = buildNfeEmail({ firstName: 'Ana', number: '158', series: '1', accessKey: '3526', totalLabel: 'R$ 199,00' });
    expect(content.text).toContain('158, série 1');
    expect(content.text).toContain('R$ 199,00');
    expect(content.html).toContain('Sua nota fiscal foi autorizada');
    expect(content.html).toContain('Portal da NF-e');
  });
});

describe('when the note is authorized', () => {
  const row = (overrides = {}) => ({ id: 1, stripeInvoiceId: 'in_1', emailStatus: null, authorizedAt: null, ...overrides });
  const service = (enabled, overrides = {}) => new BlingNfeService({ emailService: { enabled }, now: () => NOW, ...overrides });

  test('queues the email once', () => {
    expect(service(true).emailOwed(row(), NOW)).toEqual({ emailStatus: 'pending', emailNextAttemptAt: NOW });
    expect(service(true).emailOwed(row({ emailStatus: 'sent' }), NOW)).toEqual({});
  });

  test('skips a note created in Bling and records why when turned off', () => {
    expect(service(true).emailOwed(row({ stripeInvoiceId: 'bling:9' }), NOW)).toEqual({});
    expect(service(false).emailOwed(row(), NOW)).toMatchObject({ emailStatus: 'skipped' });
  });

  test('a failed email run does not count as a failed note', async () => {
    const logger = { error: jest.fn() };
    const blingNfe = service(true, { logger });
    blingNfe.emailService.sendDue = jest.fn(async () => { throw new Error('db'); });
    await expect(blingNfe.sendEmails()).resolves.toEqual({ emailsFailed: 1 });
  });

  describe('resendEmail', () => {
    const repository = (current) => ({
      findById: jest.fn(async () => current),
      queueEmail: jest.fn(async () => true)
    });
    const authorized = row({ status: 'authorized', stripeAccount: 'br', emailStatus: 'sent' });

    test('queues the note and audits who asked', async () => {
      const auditService = { record: jest.fn() };
      const repo = repository(authorized);
      const blingNfe = service(true, { repository: repo, auditService });
      await blingNfe.resendEmail(1, { userId: '5' });
      expect(repo.queueEmail).toHaveBeenCalledWith(1, { now: NOW });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'nfe.email.resend' }));
    });

    test.each([
      ['turned off', false, authorized, 'nfe_email_disabled'],
      ['a send in progress', true, { ...authorized, emailStatus: 'sending' }, 'nfe_email_not_sendable'],
      ['a note not authorized', true, { ...authorized, status: 'rejected' }, 'nfe_email_not_sendable']
    ])('refuses %s', async (_name, enabled, current, code) => {
      const repo = repository(current);
      await expect(service(enabled, { repository: repo }).resendEmail(1, {})).rejects.toMatchObject({ statusCode: 409, details: { code } });
      expect(repo.queueEmail).not.toHaveBeenCalled();
    });
  });
});
