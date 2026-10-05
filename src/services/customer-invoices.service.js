const crypto = require('crypto');
const { HttpError } = require('../core/http-error');
const { ledgerStripeAccount, parseStripeAccountInput } = require('../core/stripe-account');
const { extractSubscriptionIdFromInvoice, parseJsonColumn } = require('../core/stripe-subscription-map');
const { assertStripeAccountMarket, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { resolveStripeBilling } = require('../infrastructure/stripe/stripe-accounts');
const { buildInvoiceDocument, formatInvoiceMoney, formatLongDate, invoiceLocale, linePriceId } = require('../core/invoice/invoice-document');
const { formatInvoiceNumber, invoiceYear } = require('../core/invoice/invoice-number');
const { buildInvoiceEmail } = require('../core/email/transactional-emails');
const { dashboardPlansUrl } = require('../core/email/mail-context');
const { withTimeout } = require('../core/with-timeout');

const ISSUABLE_STATUSES = new Set(['paid', 'open']);
const EMAIL_MAX_ATTEMPTS = 8;
const EMAIL_BATCH = 20;
const SMTP_TIMEOUT_MS = 30 * 1000;

function present(row) {
  return {
    id: row.id,
    invoice_number: row.invoiceNumber,
    stripe_invoice_id: row.stripeInvoiceId,
    stripe_account: row.stripeAccount,
    locale: row.locale,
    currency: row.currency,
    total_minor: row.totalMinor,
    amount_paid_minor: row.amountPaidMinor,
    invoice_status: row.invoiceStatus,
    billing_reason: row.billingReason,
    issued_at: row.issuedAt,
    pdf_available: Boolean(row.pdfFilename),
    pdf_generated_at: row.pdfGeneratedAt,
    email_to: row.emailTo,
    email_status: row.emailStatus,
    email_sent_at: row.emailSentAt,
    email_attempts: row.emailAttempts,
    email_last_error: row.emailLastError,
    email_next_attempt_at: row.emailNextAttemptAt
  };
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

function unixToDate(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000) : new Date();
}

class CustomerInvoicesService {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.storage = options.storage || null;
    this.renderPdf = options.renderPdf || null;
    this.mailer = options.mailer || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.shippingProductIds = (options.shippingProductIds || []).filter(Boolean);
    this.storeAppUrl = options.storeAppUrl || '';
    this.emailAssetBaseUrl = options.emailAssetBaseUrl || '';
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
    this.now = options.now || (() => new Date());
  }

  ensureReady() {
    if (!this.repository || !this.storage || !this.renderPdf) {
      throw new HttpError(503, 'Invoice service is not available.', { code: 'invoices_unavailable' });
    }
  }

  billingFor(account) {
    return resolveStripeBilling(this, account);
  }

  async retrieveFullInvoice(invoice, account) {
    const billing = this.billingFor(account);
    if (billing && typeof billing.retrieveInvoiceWithLines === 'function') {
      return billing.retrieveInvoiceWithLines(invoice.id);
    }
    return invoice;
  }

  /**
   * Issues the Eden Bowls invoice of a Stripe invoice: reserves the EB number once, renders the PDF, stores it,
   * and emails it when `send` is true. Repeating it for the same Stripe invoice keeps the number; the PDF is
   * written again only when it is missing or the Stripe status changed (open → paid).
   * Throws when Stripe or the disk fail, so the webhook that called it is retried.
   */
  async issueForInvoice({ invoice, account, ledger = null, send = true }) {
    this.ensureReady();
    const stripeAccount = parseStripeAccountInput(account, 'us');
    if (!invoice || !invoice.id) {
      return { skipped: true, reason: 'missing_invoice' };
    }
    const full = await this.retrieveFullInvoice(invoice, stripeAccount);
    const status = String(full.status || '');
    if (!ISSUABLE_STATUSES.has(status)) {
      return { skipped: true, reason: 'status_not_issuable' };
    }
    if (!(Number(full.total) > 0)) {
      return { skipped: true, reason: 'zero_total' };
    }

    const subscriptionId = extractSubscriptionIdFromInvoice(full);
    const ledgerRow = ledger || (subscriptionId && this.ledgerRepository
      ? await this.ledgerRepository.findByStripeSubscriptionId(subscriptionId)
      : null) || {};
    let row = await this.repository.findByStripeInvoice(stripeAccount, full.id);
    if (row && row.pdfFilename && row.invoiceStatus === status) {
      if (send && row.emailStatus === 'pending') {
        row = await this.sendEmail(row, {});
      }
      return { row, created: false };
    }

    let created = false;
    if (!row) {
      const locale = invoiceLocale(stripeAccount, parseJsonColumn(ledgerRow.address) || {});
      const issuedAt = full.status_transitions && full.status_transitions.finalized_at || full.created;
      const sequence = await this.repository.nextSequence(invoiceYear(issuedAt, locale));
      const inserted = await this.repository.insertOrGet({
        invoiceNumber: formatInvoiceNumber(invoiceYear(issuedAt, locale), sequence),
        stripeAccount,
        stripeInvoiceId: full.id,
        stripeSubscriptionId: subscriptionId,
        userId: ledgerRow.userId || null,
        locale,
        currency: String(full.currency || '').toLowerCase(),
        totalMinor: Number(full.total) || 0,
        amountPaidMinor: Number(full.amount_paid) || 0,
        invoiceStatus: status,
        billingReason: full.billing_reason || null,
        issuedAt: unixToDate(issuedAt),
        customerName: String(full.customer_name || '').trim() || null,
        emailTo: String(full.customer_email || ledgerRow.customerEmail || '').trim() || null
      });
      row = inserted.row;
      created = inserted.created;
    }

    await this.renderAndStore(row, full, ledgerRow, stripeAccount);
    row = await this.repository.findById(row.id);
    if (send && row.emailStatus === 'pending') {
      row = await this.sendEmail(row, {});
    }
    return { row, created };
  }

  async renderAndStore(row, invoice, ledgerRow, stripeAccount) {
    const lines = invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
    const variants = await this.repository.findVariantsByPriceIds(lines.map(linePriceId));
    const model = buildInvoiceDocument({
      invoice,
      invoiceNumber: row.invoiceNumber,
      stripeAccount,
      ledger: ledgerRow,
      variants,
      shippingProductIds: this.shippingProductIds
    });
    const buffer = await this.renderPdf(model);
    const filename = await this.storage.write({ invoiceNumber: row.invoiceNumber, buffer });
    await this.repository.markPdf(row.id, {
      filename,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      generatedAt: this.now(),
      invoiceStatus: String(invoice.status || ''),
      amountPaidMinor: Number(invoice.amount_paid) || 0
    });
    return model;
  }

  // Writes the PDF again from Stripe, under the same number.
  async regenerate(row) {
    const full = await this.retrieveFullInvoice({ id: row.stripeInvoiceId }, row.stripeAccount);
    const ledgerRow = row.stripeSubscriptionId && this.ledgerRepository
      ? await this.ledgerRepository.findByStripeSubscriptionId(row.stripeSubscriptionId) || {}
      : {};
    return this.renderAndStore(row, full, ledgerRow, row.stripeAccount);
  }

  async readPdf(row) {
    let buffer = row.pdfFilename ? await this.storage.read(row.pdfFilename) : null;
    if (!buffer) {
      await this.regenerate(row);
      const fresh = await this.repository.findById(row.id);
      buffer = fresh && fresh.pdfFilename ? await this.storage.read(fresh.pdfFilename) : null;
    }
    if (!buffer) {
      throw new HttpError(404, 'Invoice PDF not found.', { code: 'invoice_pdf_not_found' });
    }
    return buffer;
  }

  /**
   * Emails the PDF to the customer. A send records `email_sent_at`; an SMTP failure is recorded with the next
   * retry time and never thrown, so the payment flow that called it goes on.
   */
  async sendEmail(row, { to = '' } = {}) {
    const recipient = String(to || row.emailTo || '').trim();
    if (!recipient) {
      return this.repository.markEmailFailed(row.id, {
        error: 'Customer email is missing.',
        now: this.now(),
        maxAttempts: 1
      });
    }
    if (!this.mailer || typeof this.mailer.sendMail !== 'function') {
      return this.repository.markEmailSkipped(row.id, { to: recipient, reason: 'Mailer is not available.' });
    }

    try {
      const buffer = await this.readPdf(row);
      const content = buildInvoiceEmail({
        firstName: firstName(row.customerName),
        invoiceNumber: row.invoiceNumber,
        totalLabel: formatInvoiceMoney(row.totalMinor, row.currency, row.locale),
        issuedLabel: formatLongDate(row.issuedAt, row.locale),
        paid: row.invoiceStatus === 'paid',
        dashboardUrl: this.storeAppUrl ? dashboardPlansUrl(this.storeAppUrl) : '',
        locale: row.locale,
        assetBaseUrl: this.emailAssetBaseUrl
      });
      const result = await withTimeout(this.mailer.sendMail({
        to: recipient,
        subject: content.subject,
        text: content.text,
        html: content.html,
        attachments: [{ filename: `${row.invoiceNumber}.pdf`, content: buffer, contentType: 'application/pdf' }]
      }), SMTP_TIMEOUT_MS);
      if (result && result.skipped) {
        return this.repository.markEmailSkipped(row.id, { to: recipient, reason: 'SMTP is not configured.' });
      }
      this.logger.info({ invoiceNumber: row.invoiceNumber }, 'Invoice email sent.');
      return this.repository.markEmailSent(row.id, { to: recipient, sentAt: this.now() });
    } catch (error) {
      this.logger.error({
        invoiceNumber: row.invoiceNumber,
        code: error && error.code ? error.code : 'invoice_email_failed'
      }, 'Invoice email failed.');
      return this.repository.markEmailFailed(row.id, {
        to: recipient,
        error: error && error.message ? error.message : 'Invoice email failed.',
        now: this.now(),
        maxAttempts: EMAIL_MAX_ATTEMPTS
      });
    }
  }

  // The PDF as a letter attachment (order confirmation, renewal).
  async letterAttachment(row) {
    const content = await this.readPdf(row);
    return {
      invoiceNumber: row.invoiceNumber,
      filename: `${row.invoiceNumber}.pdf`,
      content,
      contentType: 'application/pdf'
    };
  }

  // The letter that carried the PDF went out: that is the send to the customer.
  async recordSentWithLetter(row, { to }) {
    return this.repository.markEmailSent(row.id, { to: String(to || row.emailTo || '').trim(), sentAt: this.now() });
  }

  // Background job: sends what the webhook could not, with backoff.
  async sendDueEmails() {
    if (!this.repository) return { scanned: 0, sent: 0 };
    const rows = await this.repository.listEmailDue({ now: this.now(), limit: EMAIL_BATCH });
    let sent = 0;
    for (const row of rows) {
      try {
        const updated = await this.sendEmail(row, {});
        if (updated && updated.emailStatus === 'sent') sent += 1;
      } catch (error) {
        this.logger.error({ invoiceNumber: row.invoiceNumber, code: error && error.code }, 'Invoice email retry failed.');
      }
    }
    return { scanned: rows.length, sent };
  }

  // ---- Admin ----

  async requireSubscription(subscriptionId, actor) {
    if (!this.ledgerRepository) {
      throw new HttpError(503, 'Billing ledger is not available.');
    }
    const item = await this.ledgerRepository.findById(subscriptionId);
    if (!item) {
      throw new HttpError(404, 'Subscription not found.');
    }
    if (shouldEnforceMarketScope(actor)) {
      assertStripeAccountMarket(actor, ledgerStripeAccount(item));
    }
    return item;
  }

  async requireInvoice(id, actor) {
    this.ensureReady();
    const row = await this.repository.findById(Number(id));
    if (!row) {
      throw new HttpError(404, 'Invoice not found.', { code: 'invoice_not_found' });
    }
    if (shouldEnforceMarketScope(actor)) {
      try {
        assertStripeAccountMarket(actor, row.stripeAccount);
      } catch (_error) {
        throw new HttpError(404, 'Invoice not found.', { code: 'invoice_not_found' });
      }
    }
    return row;
  }

  async listForSubscription(subscriptionId, actor = {}) {
    this.ensureReady();
    const item = await this.requireSubscription(subscriptionId, actor);
    const rows = await this.repository.listBySubscription(item.stripeSubscriptionId);
    return { success: true, data: { items: rows.map(present) } };
  }

  // Issues the invoice of an older Stripe invoice of this subscription, without emailing it.
  async issueFromAdmin(subscriptionId, stripeInvoiceId, actor = {}) {
    const item = await this.requireSubscription(subscriptionId, actor);
    const id = String(stripeInvoiceId || '').trim();
    if (!id.startsWith('in_')) {
      throw new HttpError(400, 'stripe_invoice_id is required.', { code: 'stripe_invoice_id_required' });
    }
    const account = ledgerStripeAccount(item);
    const full = await this.retrieveFullInvoice({ id }, account);
    if (extractSubscriptionIdFromInvoice(full) !== item.stripeSubscriptionId) {
      throw new HttpError(404, 'Invoice not found for this subscription.', { code: 'invoice_not_found' });
    }
    const result = await this.issueForInvoice({ invoice: full, account, ledger: item, send: false });
    if (result.skipped) {
      throw new HttpError(422, 'This Stripe invoice cannot be issued.', { code: result.reason });
    }
    return { success: true, data: present(result.row) };
  }

  async downloadPdf(id, actor = {}) {
    const row = await this.requireInvoice(id, actor);
    const buffer = await this.readPdf(row);
    return { binary: true, buffer, contentType: 'application/pdf', filename: `${row.invoiceNumber}.pdf` };
  }

  async resendEmail(id, actor = {}, { to = '' } = {}) {
    const row = await this.requireInvoice(id, actor);
    const updated = await this.sendEmail(row, { to });
    return { success: updated.emailStatus === 'sent', data: present(updated) };
  }
}

module.exports = {
  CustomerInvoicesService,
  presentCustomerInvoice: present
};
