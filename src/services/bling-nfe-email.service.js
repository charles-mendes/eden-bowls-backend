const { DateTime } = require('luxon');
const { NFE_EMAIL_STATUS, NFE_STATUS, nfeStatusFromSituacao } = require('../core/nfe');
const { buildNfeEmail } = require('../core/email/transactional-emails');
const { withTimeout } = require('../core/with-timeout');

const EMAIL_BATCH = 10;
const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const SMTP_TIMEOUT_MS = 20 * 1000;
// Long past any send. A claim this old lost its process somewhere between the SMTP server and the database.
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_ERROR_LENGTH = 1000;
const TIMEZONE = 'America/Sao_Paulo';

// The SMTP server may have taken the message, so sending again could deliver it twice.
class EmailOutcomeUnknownError extends Error {}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function nextAttemptAt(attempts, now) {
  if (attempts >= MAX_ATTEMPTS) return null;
  return new Date(now.getTime() + Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS));
}

/**
 * Emails the DANFE and the XML once the note is authorized. It runs inside the bling_nfe job, which holds the Bling
 * lock. Bling's own `enviarEmail` stays off, so this is the only sender.
 *
 * A note is claimed in the database before anything is sent. Losing the process after the claim leaves the customer
 * possibly without the email, never with two: the panel shows it and an operator decides.
 */
class BlingNfeEmailService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.client = options.client;
    this.mailer = options.mailer || null;
    this.enabled = options.enabled === true;
    this.emailAssetBaseUrl = options.emailAssetBaseUrl;
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
    this.now = options.now || (() => new Date());
  }

  async sendDue({ limit = EMAIL_BATCH } = {}) {
    if (!this.enabled) return { sent: 0, failed: 0 };
    const now = this.now();
    await this.repository.failStaleEmails({
      before: new Date(now.getTime() - STALE_CLAIM_MS),
      error: 'O envio foi interrompido e pode ter chegado ao cliente. Confira antes de reenviar.'
    });
    const rows = await this.repository.listEmailDue({ now, limit });
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      if (!(await this.repository.claimEmail(row.id, { now: this.now() }))) continue;
      const attempts = row.emailAttempts + 1;
      try {
        if (await this.deliver(row)) sent += 1;
      } catch (error) {
        failed += 1;
        await this.recordFailure(row, attempts, error);
      }
    }
    return { sent, failed };
  }

  async deliver(row) {
    // The last check: a note canceled after the authorization must not reach the customer as valid.
    const nfe = await this.client.getNfe(row.blingNfeId);
    if (nfeStatusFromSituacao(nfe.situacao) !== NFE_STATUS.AUTHORIZED) {
      await this.finish(row, NFE_EMAIL_STATUS.SKIPPED, 'A nota não está mais autorizada no Bling.');
      return false;
    }
    if (!row.customerEmail) {
      throw new Error('A nota não tem e-mail do cliente.');
    }
    if (!this.mailer || typeof this.mailer.sendMail !== 'function') {
      await this.finish(row, NFE_EMAIL_STATUS.SKIPPED, 'O envio de e-mail não está disponível.');
      return false;
    }

    const pdf = await this.client.downloadDocument(nfe.linkPDF || row.pdfUrl);
    if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new Error('O Bling não devolveu o PDF do DANFE.');
    }
    const xml = await this.xmlOf(nfe, row);
    const number = nfe.numero == null ? row.nfeNumber : String(nfe.numero);
    const accessKey = nfe.chaveAcesso || row.accessKey;
    const authorizedAt = row.authorizedAt ? DateTime.fromISO(row.authorizedAt).setZone(TIMEZONE) : null;
    const content = buildNfeEmail({
      firstName: firstNameOf(row.customerName),
      number,
      series: nfe.serie == null ? row.nfeSeries : String(nfe.serie),
      accessKey,
      authorizedLabel: authorizedAt ? authorizedAt.setLocale('pt-BR').toLocaleString(DateTime.DATE_FULL) : '',
      totalLabel: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: String(row.currency || 'brl').toUpperCase() }).format(row.totalMinor / 100),
      homologation: /<tpAmb>\s*2\s*<\/tpAmb>/.test(xml.toString('utf8')),
      assetBaseUrl: this.emailAssetBaseUrl
    });

    let result;
    try {
      result = await withTimeout(this.mailer.sendMail({
        to: row.customerEmail,
        subject: content.subject,
        text: content.text,
        html: content.html,
        attachments: [
          { filename: `DANFE-${number}.pdf`, content: pdf, contentType: 'application/pdf' },
          { filename: `NFe-${accessKey}.xml`, content: xml, contentType: 'application/xml' }
        ]
      }), SMTP_TIMEOUT_MS);
    } catch (error) {
      if (error && error.code === 'timeout') {
        throw new EmailOutcomeUnknownError('O servidor de e-mail não respondeu e a mensagem pode ter sido entregue. Confira antes de reenviar.');
      }
      throw error;
    }
    if (result && result.skipped) {
      await this.finish(row, NFE_EMAIL_STATUS.SKIPPED, 'O SMTP não está configurado.');
      return false;
    }
    await this.finish(row, NFE_EMAIL_STATUS.SENT, null);
    this.logger.info({ nfeId: row.id }, 'NF-e email sent.');
    return true;
  }

  // Bling answers with a link or with the document itself, depending on the note.
  async xmlOf(nfe, row) {
    const source = nfe.xml || row.xmlUrl;
    const xml = isUrl(source) ? await this.client.downloadDocument(source) : Buffer.from(String(source || ''), 'utf8');
    if (!xml.toString('utf8').trimStart().startsWith('<')) {
      throw new Error('O Bling não devolveu o XML da nota.');
    }
    return xml;
  }

  async finish(row, status, reason) {
    const sent = status === NFE_EMAIL_STATUS.SENT;
    await this.repository.update(row.id, {
      emailStatus: status,
      emailTo: row.customerEmail,
      emailLastError: reason,
      emailNextAttemptAt: null,
      ...(sent ? { emailSentAt: this.now() } : {})
    });
  }

  async recordFailure(row, attempts, error) {
    const unknown = error instanceof EmailOutcomeUnknownError || !row.customerEmail;
    this.logger.error({ nfeId: row.id, code: error && error.code ? error.code : 'nfe_email_failed' }, 'NF-e email failed.');
    await this.repository.update(row.id, {
      emailStatus: NFE_EMAIL_STATUS.FAILED,
      emailTo: row.customerEmail,
      emailLastError: String((error && error.message) || 'Falha ao enviar o e-mail.').slice(0, MAX_ERROR_LENGTH),
      emailNextAttemptAt: unknown ? null : nextAttemptAt(attempts, this.now())
    });
  }
}

module.exports = {
  BlingNfeEmailService,
  MAX_ATTEMPTS
};
