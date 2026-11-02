const { toMysqlDateTime } = require('../../core/stripe-subscription-map');
const { NFE_EMAIL_STATUS, NFE_RETRYABLE_STATUSES, NFE_STATUS } = require('../../core/nfe');
const { FISCAL_NAME_META_KEY, TAX_DOCUMENT_META_KEY } = require('../../core/tax-document');

const TABLE = 'bling_nfe';
const COLUMNS = {
  status: 'status',
  blingContactId: 'bling_contact_id',
  blingOrderId: 'bling_order_id',
  blingNfeId: 'bling_nfe_id',
  nfeNumber: 'nfe_number',
  nfeSeries: 'nfe_series',
  accessKey: 'access_key',
  protocol: 'protocol',
  blingSituacao: 'bling_situacao',
  customerName: 'customer_name',
  customerEmail: 'customer_email',
  customerDocument: 'customer_document',
  customerAddress: 'customer_address',
  requestPayload: 'request_payload',
  responsePayload: 'response_payload',
  danfeUrl: 'danfe_url',
  pdfUrl: 'pdf_url',
  xmlUrl: 'xml_url',
  lastError: 'last_error',
  attempts: 'attempts',
  nextAttemptAt: 'next_attempt_at',
  submittedAt: 'submitted_at',
  authorizedAt: 'authorized_at',
  createdAt: 'created_at',
  emailStatus: 'email_status',
  emailTo: 'email_to',
  emailSentAt: 'email_sent_at',
  emailLastError: 'email_last_error',
  emailNextAttemptAt: 'email_next_attempt_at'
};
const JSON_COLUMNS = new Set(['customerAddress', 'requestPayload', 'responsePayload']);

function isoOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJson(value) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || 'null'));
  } catch (_error) {
    return null;
  }
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    status: row.status,
    userId: numberOrNull(row.user_id),
    stripeAccount: row.stripe_account,
    stripeSubscriptionId: row.stripe_subscription_id || null,
    stripeInvoiceId: row.stripe_invoice_id,
    blingContactId: numberOrNull(row.bling_contact_id),
    blingOrderId: numberOrNull(row.bling_order_id),
    blingNfeId: numberOrNull(row.bling_nfe_id),
    nfeNumber: row.nfe_number || null,
    nfeSeries: row.nfe_series || null,
    accessKey: row.access_key || null,
    protocol: row.protocol || null,
    blingSituacao: numberOrNull(row.bling_situacao),
    totalMinor: Number(row.total_minor) || 0,
    currency: row.currency,
    customerName: row.customer_name || null,
    customerEmail: row.customer_email || null,
    customerDocument: row.customer_document || null,
    customerAddress: parseJson(row.customer_address),
    requestPayload: parseJson(row.request_payload),
    responsePayload: parseJson(row.response_payload),
    danfeUrl: row.danfe_url || null,
    pdfUrl: row.pdf_url || null,
    xmlUrl: row.xml_url || null,
    lastError: row.last_error || null,
    attempts: Number(row.attempts) || 0,
    nextAttemptAt: isoOrNull(row.next_attempt_at),
    submittedAt: isoOrNull(row.submitted_at),
    authorizedAt: isoOrNull(row.authorized_at),
    emailStatus: row.email_status || null,
    emailTo: row.email_to || null,
    emailSentAt: isoOrNull(row.email_sent_at),
    emailAttempts: Number(row.email_attempts) || 0,
    emailLastError: row.email_last_error || null,
    emailNextAttemptAt: isoOrNull(row.email_next_attempt_at),
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at)
  };
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

class BlingNfeRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.usersTable = options.usersTableName || 'wp_users';
    this.usermetaTable = options.usermetaTableName || 'wp_usermeta';
    this.stateTable = options.stateTableName || 'onboarding_user_state';
  }

  async findById(id) {
    const rows = await this.dataSource.query(`SELECT * FROM \`${TABLE}\` WHERE \`id\` = ? LIMIT 1`, [id]);
    return mapRow(rows && rows[0]);
  }

  async findByStripeInvoice(stripeAccount, stripeInvoiceId) {
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${TABLE}\` WHERE \`stripe_account\` = ? AND \`stripe_invoice_id\` = ? LIMIT 1`,
      [stripeAccount, stripeInvoiceId]
    );
    return mapRow(rows && rows[0]);
  }

  async findByBlingNfeIds(ids) {
    if (!ids.length) return new Map();
    const marks = ids.map(() => '?').join(', ');
    const rows = await this.dataSource.query(`SELECT * FROM \`${TABLE}\` WHERE \`bling_nfe_id\` IN (${marks})`, ids);
    return new Map(rows.map(mapRow).map((row) => [row.blingNfeId, row]));
  }

  async listBySubscription(stripeSubscriptionId) {
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${TABLE}\` WHERE \`stripe_subscription_id\` = ? ORDER BY \`id\` DESC`,
      [stripeSubscriptionId]
    );
    return rows.map(mapRow);
  }

  // The unique key on (stripe_account, stripe_invoice_id) keeps a repeated webhook to one row.
  async insertOrGet(input) {
    await this.dataSource.query(
      `INSERT IGNORE INTO \`${TABLE}\`
        (\`status\`, \`user_id\`, \`stripe_account\`, \`stripe_subscription_id\`, \`stripe_invoice_id\`, \`total_minor\`,
         \`currency\`, \`customer_name\`, \`customer_email\`, \`customer_document\`, \`customer_address\`, \`next_attempt_at\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.status,
        input.userId,
        input.stripeAccount,
        input.stripeSubscriptionId,
        input.stripeInvoiceId,
        input.totalMinor,
        input.currency,
        input.customerName,
        input.customerEmail,
        input.customerDocument,
        JSON.stringify(input.customerAddress || null),
        toMysqlDateTime(input.nextAttemptAt)
      ]
    );
    return this.findByStripeInvoice(input.stripeAccount, input.stripeInvoiceId);
  }

  async update(id, patch) {
    const keys = Object.keys(patch).filter((key) => COLUMNS[key]);
    if (!keys.length) return;
    const assignments = keys.map((key) => `\`${COLUMNS[key]}\` = ?`).join(', ');
    const values = keys.map((key) => {
      const value = patch[key];
      if (JSON_COLUMNS.has(key)) return JSON.stringify(value == null ? null : value);
      return value instanceof Date ? toMysqlDateTime(value) : value;
    });
    await this.dataSource.query(`UPDATE \`${TABLE}\` SET ${assignments} WHERE \`id\` = ?`, [...values, id]);
  }

  async listDue({ now = new Date(), limit = 10 } = {}) {
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${TABLE}\`
       WHERE \`status\` IN (?, ?, ?) AND \`next_attempt_at\` IS NOT NULL AND \`next_attempt_at\` <= ?
       ORDER BY \`next_attempt_at\` ASC LIMIT ?`,
      [NFE_STATUS.PENDING, NFE_STATUS.ERROR, NFE_STATUS.SUBMITTED, toMysqlDateTime(now), limit]
    );
    return rows.map(mapRow);
  }

  async listEmailDue({ now = new Date(), limit = 10 } = {}) {
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${TABLE}\`
       WHERE \`status\` = ? AND \`email_status\` IN (?, ?) AND \`email_next_attempt_at\` IS NOT NULL AND \`email_next_attempt_at\` <= ?
       ORDER BY \`email_next_attempt_at\` ASC LIMIT ?`,
      [NFE_STATUS.AUTHORIZED, NFE_EMAIL_STATUS.PENDING, NFE_EMAIL_STATUS.FAILED, toMysqlDateTime(now), limit]
    );
    return rows.map(mapRow);
  }

  // Only one caller gets affectedRows = 1, so a note is never sent by two runs at once.
  async claimEmail(id, { now = new Date() } = {}) {
    const result = await this.dataSource.query(
      `UPDATE \`${TABLE}\`
       SET \`email_status\` = ?, \`email_claimed_at\` = ?, \`email_attempts\` = \`email_attempts\` + 1, \`email_next_attempt_at\` = NULL
       WHERE \`id\` = ? AND \`status\` = ? AND \`email_status\` IN (?, ?) AND \`email_next_attempt_at\` IS NOT NULL`,
      [NFE_EMAIL_STATUS.SENDING, toMysqlDateTime(now), id, NFE_STATUS.AUTHORIZED, NFE_EMAIL_STATUS.PENDING, NFE_EMAIL_STATUS.FAILED]
    );
    return Number(result && result.affectedRows) === 1;
  }

  // No retry: the message may have left before the process died.
  async failStaleEmails({ before, error }) {
    await this.dataSource.query(
      `UPDATE \`${TABLE}\` SET \`email_status\` = ?, \`email_last_error\` = ?, \`email_next_attempt_at\` = NULL
       WHERE \`email_status\` = ? AND \`email_claimed_at\` <= ?`,
      [NFE_EMAIL_STATUS.FAILED, error, NFE_EMAIL_STATUS.SENDING, toMysqlDateTime(before)]
    );
  }

  // An operator's decision to send again. A send in progress is left alone.
  async queueEmail(id, { now = new Date() } = {}) {
    const result = await this.dataSource.query(
      `UPDATE \`${TABLE}\`
       SET \`email_status\` = ?, \`email_attempts\` = 0, \`email_last_error\` = NULL, \`email_next_attempt_at\` = ?
       WHERE \`id\` = ? AND \`status\` = ? AND (\`email_status\` IS NULL OR \`email_status\` <> ?)`,
      [NFE_EMAIL_STATUS.PENDING, toMysqlDateTime(now), id, NFE_STATUS.AUTHORIZED, NFE_EMAIL_STATUS.SENDING]
    );
    return Number(result && result.affectedRows) === 1;
  }

  // The status check lives in the UPDATE, so two clicks or a stale screen cannot queue a note in any other state.
  async requeue(id, { now = new Date() } = {}) {
    const marks = NFE_RETRYABLE_STATUSES.map(() => '?').join(', ');
    const result = await this.dataSource.query(
      `UPDATE \`${TABLE}\` SET \`status\` = ?, \`next_attempt_at\` = ? WHERE \`id\` = ? AND \`status\` IN (${marks})`,
      [NFE_STATUS.PENDING, toMysqlDateTime(now), id, ...NFE_RETRYABLE_STATUSES]
    );
    return Number(result && result.affectedRows) === 1;
  }

  async list({ status, from, to, search, stripeAccount, offset = 0, perPage = 20 } = {}) {
    const where = [];
    const params = [];
    if (status) {
      where.push('`status` = ?');
      params.push(status);
    }
    if (stripeAccount) {
      where.push('`stripe_account` = ?');
      params.push(stripeAccount);
    }
    if (from) {
      where.push('`created_at` >= ?');
      params.push(toMysqlDateTime(from));
    }
    if (to) {
      where.push('`created_at` < ?');
      params.push(toMysqlDateTime(to));
    }
    const term = String(search || '').trim();
    if (term) {
      const like = `%${escapeLike(term)}%`;
      const digits = term.replace(/\D/g, '');
      const digitsLike = digits ? `%${digits}%` : like;
      where.push(`(\`customer_name\` LIKE ? OR \`customer_email\` LIKE ? OR \`customer_document\` LIKE ?
        OR \`nfe_number\` LIKE ? OR \`access_key\` LIKE ?)`);
      params.push(like, like, digitsLike, digitsLike, digitsLike);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totals = await this.dataSource.query(`SELECT COUNT(*) AS total FROM \`${TABLE}\` ${clause}`, params);
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${TABLE}\` ${clause} ORDER BY \`id\` DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );
    return { items: rows.map(mapRow), total: Number(totals && totals[0] && totals[0].total) || 0 };
  }

  // Name, email, saved document and the address of the customer's profile.
  async findCustomer(userId) {
    const rows = await this.dataSource.query(
      `SELECT u.\`user_email\`, u.\`display_name\`, s.\`address\`,
         (SELECT m.\`meta_value\` FROM \`${this.usermetaTable}\` m
           WHERE m.\`user_id\` = u.\`ID\` AND m.\`meta_key\` = ? ORDER BY m.\`umeta_id\` DESC LIMIT 1) AS tax_document,
         (SELECT m.\`meta_value\` FROM \`${this.usermetaTable}\` m
           WHERE m.\`user_id\` = u.\`ID\` AND m.\`meta_key\` = ? ORDER BY m.\`umeta_id\` DESC LIMIT 1) AS fiscal_name
       FROM \`${this.usersTable}\` u
       LEFT JOIN \`${this.stateTable}\` s ON s.\`user_id\` = u.\`ID\`
       WHERE u.\`ID\` = ? LIMIT 1`,
      [TAX_DOCUMENT_META_KEY, FISCAL_NAME_META_KEY, userId]
    );
    const row = rows && rows[0];
    if (!row) return null;
    return {
      name: row.fiscal_name || row.display_name || '',
      email: row.user_email || '',
      taxDocument: row.tax_document || '',
      address: parseJson(row.address)
    };
  }
}

module.exports = {
  BlingNfeRepository
};
