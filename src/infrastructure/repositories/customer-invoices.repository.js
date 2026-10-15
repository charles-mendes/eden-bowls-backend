const { toMysqlDateTime } = require('../../core/stripe-subscription-map');
const { canonicalFlavorKey } = require('../../core/flavors');
const { parseWeightToGrams } = require('../../core/plan-catalog-pricing');

const TABLE = 'customer_invoices';
const SEQUENCES = 'customer_invoice_sequences';
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const BASE_BACKOFF_MS = 5 * 60 * 1000;
const FLAVOR_META = ['_flavor_slug', 'attribute_pa_flavor', 'attribute_flavor', 'attribute_sabor'];
const WEIGHT_META = ['attribute_pa_weight', 'attribute_weight', 'attribute_gram', 'attribute_peso'];

function isoOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapRow(row) {
  return {
    id: Number(row.id),
    invoiceNumber: row.invoice_number,
    stripeAccount: row.stripe_account,
    stripeInvoiceId: row.stripe_invoice_id,
    stripeSubscriptionId: row.stripe_subscription_id || null,
    userId: row.user_id == null ? null : Number(row.user_id),
    locale: row.locale,
    currency: row.currency,
    totalMinor: Number(row.total_minor) || 0,
    amountPaidMinor: Number(row.amount_paid_minor) || 0,
    invoiceStatus: row.invoice_status,
    billingReason: row.billing_reason || null,
    issuedAt: isoOrNull(row.issued_at),
    pdfFilename: row.pdf_filename || null,
    pdfSha256: row.pdf_sha256 || null,
    pdfGeneratedAt: isoOrNull(row.pdf_generated_at),
    customerName: row.customer_name || null,
    emailTo: row.email_to || null,
    emailStatus: row.email_status,
    emailSentAt: isoOrNull(row.email_sent_at),
    emailAttempts: Number(row.email_attempts) || 0,
    emailLastError: row.email_last_error || null,
    emailNextAttemptAt: isoOrNull(row.email_next_attempt_at),
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at)
  };
}

// Exponential backoff from five minutes, capped at six hours.
function emailBackoffMs(attempts) {
  return Math.min(BASE_BACKOFF_MS * (2 ** Math.max(0, attempts - 1)), MAX_BACKOFF_MS);
}

function firstMeta(meta, keys) {
  for (const key of keys) {
    const value = String(meta[key] == null ? '' : meta[key]).trim();
    if (value) return value;
  }
  return '';
}

class CustomerInvoicesRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.postmetaTableName = options.postmetaTableName || 'wp_postmeta';
  }

  // LAST_INSERT_ID(expr) keeps the new value on this connection, so the read below sees only this call's number
  // even when two invoices are paid at the same moment.
  async nextSequence(year) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(
        `INSERT INTO ${SEQUENCES} (\`year\`, \`last_value\`) VALUES (?, LAST_INSERT_ID(1))
          ON DUPLICATE KEY UPDATE \`last_value\` = LAST_INSERT_ID(\`last_value\` + 1)`,
        [year]
      );
      const rows = await runner.query('SELECT LAST_INSERT_ID() AS value');
      return Number(rows[0].value);
    } finally {
      await runner.release();
    }
  }

  async findById(id) {
    const rows = await this.dataSource.query(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findByStripeInvoice(stripeAccount, stripeInvoiceId) {
    const rows = await this.dataSource.query(
      `SELECT * FROM ${TABLE} WHERE stripe_account = ? AND stripe_invoice_id = ?`,
      [stripeAccount, stripeInvoiceId]
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async listBySubscription(stripeSubscriptionId) {
    const rows = await this.dataSource.query(
      `SELECT * FROM ${TABLE} WHERE stripe_subscription_id = ? ORDER BY issued_at DESC, id DESC`,
      [stripeSubscriptionId]
    );
    return rows.map(mapRow);
  }

  // Inserts the row that reserves the number. A repeated Stripe event finds the row already there and gets it back.
  async insertOrGet(input) {
    const result = await this.dataSource.query(
      `INSERT IGNORE INTO ${TABLE}
        (invoice_number, stripe_account, stripe_invoice_id, stripe_subscription_id, user_id, locale, currency,
         total_minor, amount_paid_minor, invoice_status, billing_reason, issued_at, customer_name, email_to, email_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.invoiceNumber,
        input.stripeAccount,
        input.stripeInvoiceId,
        input.stripeSubscriptionId || null,
        input.userId || null,
        input.locale,
        input.currency,
        input.totalMinor,
        input.amountPaidMinor,
        input.invoiceStatus,
        input.billingReason || null,
        toMysqlDateTime(input.issuedAt),
        input.customerName ? String(input.customerName).slice(0, 255) : null,
        input.emailTo || null,
        input.emailStatus || 'pending'
      ]
    );
    const row = await this.findByStripeInvoice(input.stripeAccount, input.stripeInvoiceId);
    return { row, created: Boolean(result && result.affectedRows) };
  }

  async markPdf(id, { filename, sha256, generatedAt, invoiceStatus, amountPaidMinor }) {
    await this.dataSource.query(
      `UPDATE ${TABLE} SET pdf_filename = ?, pdf_sha256 = ?, pdf_generated_at = ?,
        invoice_status = COALESCE(?, invoice_status), amount_paid_minor = COALESCE(?, amount_paid_minor)
        WHERE id = ?`,
      [filename, sha256, toMysqlDateTime(generatedAt), invoiceStatus || null, amountPaidMinor == null ? null : amountPaidMinor, id]
    );
    return this.findById(id);
  }

  async markEmailSent(id, { to, sentAt }) {
    await this.dataSource.query(
      `UPDATE ${TABLE} SET email_status = 'sent', email_to = ?, email_sent_at = ?, email_attempts = email_attempts + 1,
        email_last_error = NULL, email_next_attempt_at = NULL WHERE id = ?`,
      [to, toMysqlDateTime(sentAt), id]
    );
    return this.findById(id);
  }

  // SMTP is not configured outside production: nothing left the server, so the row is not marked as sent.
  async markEmailSkipped(id, { to, reason }) {
    await this.dataSource.query(
      `UPDATE ${TABLE} SET email_status = 'skipped', email_to = ?, email_last_error = ?, email_next_attempt_at = NULL
        WHERE id = ?`,
      [to || null, String(reason || '').slice(0, 500) || null, id]
    );
    return this.findById(id);
  }

  async markEmailFailed(id, { to, error, now = new Date(), maxAttempts }) {
    const current = await this.findById(id);
    const attempts = (current ? current.emailAttempts : 0) + 1;
    const exhausted = maxAttempts && attempts >= maxAttempts;
    const nextAttempt = exhausted ? null : new Date(now.getTime() + emailBackoffMs(attempts));
    await this.dataSource.query(
      `UPDATE ${TABLE} SET email_status = 'failed', email_to = COALESCE(?, email_to), email_attempts = ?,
        email_last_error = ?, email_next_attempt_at = ? WHERE id = ?`,
      [to || null, attempts, String(error || '').slice(0, 500) || null, toMysqlDateTime(nextAttempt), id]
    );
    return this.findById(id);
  }

  // Rows whose email is still owed: never tried, or failed with a retry already due. A row without its PDF is
  // included too, so the job can write the file again first.
  async listEmailDue({ now = new Date(), limit = 20 } = {}) {
    const rows = await this.dataSource.query(
      `SELECT * FROM ${TABLE}
        WHERE (email_status = 'pending' AND created_at <= ?)
           OR (email_status = 'failed' AND email_next_attempt_at IS NOT NULL AND email_next_attempt_at <= ?)
        ORDER BY id ASC LIMIT ?`,
      [toMysqlDateTime(new Date(now.getTime() - 2 * 60 * 1000)), toMysqlDateTime(now), limit]
    );
    return rows.map(mapRow);
  }

  // Stripe price id → catalog variation `{ flavorKey, grams }`, read from the price ids the catalog sync stored.
  async findVariantsByPriceIds(priceIds) {
    const ids = [...new Set((priceIds || []).filter((id) => String(id || '').startsWith('price_')))];
    const result = new Map();
    if (ids.length === 0) return result;
    const likes = ids.map(() => 'meta_value LIKE ?').join(' OR ');
    const matches = await this.dataSource.query(
      `SELECT post_id, meta_value FROM ${this.postmetaTableName}
        WHERE meta_key IN ('_stripe_price_id', '_stripe_price_ids_by_currency') AND (${likes})`,
      ids.map((id) => `%${id}%`)
    );
    const postByPrice = new Map();
    for (const match of matches) {
      for (const id of ids) {
        if (String(match.meta_value || '').includes(id) && !postByPrice.has(id)) {
          postByPrice.set(id, Number(match.post_id));
        }
      }
    }
    const postIds = [...new Set(postByPrice.values())];
    if (postIds.length === 0) return result;
    const metaRows = await this.dataSource.query(
      `SELECT post_id, meta_key, meta_value FROM ${this.postmetaTableName}
        WHERE post_id IN (${postIds.map(() => '?').join(', ')}) AND meta_key IN (${[...FLAVOR_META, ...WEIGHT_META].map(() => '?').join(', ')})`,
      [...postIds, ...FLAVOR_META, ...WEIGHT_META]
    );
    const metaByPost = new Map();
    for (const row of metaRows) {
      const postId = Number(row.post_id);
      if (!metaByPost.has(postId)) metaByPost.set(postId, {});
      metaByPost.get(postId)[row.meta_key] = row.meta_value;
    }
    for (const [priceId, postId] of postByPrice.entries()) {
      const meta = metaByPost.get(postId) || {};
      const flavorKey = canonicalFlavorKey(firstMeta(meta, FLAVOR_META));
      if (!flavorKey) continue;
      result.set(priceId, { flavorKey, grams: parseWeightToGrams(firstMeta(meta, WEIGHT_META)) });
    }
    return result;
  }
}

module.exports = {
  CustomerInvoicesRepository,
  emailBackoffMs
};
