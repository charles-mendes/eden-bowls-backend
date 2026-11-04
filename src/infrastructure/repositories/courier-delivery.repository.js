const { HttpError } = require('../../core/http-error');

const ACTIVE_STATUSES = ['out_for_delivery', 'delivered'];
const FINAL_STATUSES = ['delivered', 'failed', 'canceled'];
// The stage date each final status stamps.
const STATUS_DATE_COLUMN = { delivered: 'delivered_at', failed: 'failed_at', canceled: 'canceled_at' };
const DETAIL_COLUMNS = {
  method: 'method',
  courierName: 'courier_name',
  trackingUrl: 'tracking_url',
  costMinor: 'cost_minor',
  note: 'note'
};

function isDuplicateEntry(error) {
  return Boolean(error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062));
}

function affectedRows(result) {
  if (result && typeof result.affectedRows === 'number') return result.affectedRows;
  if (Array.isArray(result) && result[0] && typeof result[0].affectedRows === 'number') return result[0].affectedRows;
  if (Array.isArray(result) && typeof result[1] === 'number') return result[1];
  return 0;
}

function rowsOf(result) {
  return Array.isArray(result) ? result : [];
}

function cleanIds(ids) {
  return [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
}

class CourierDeliveryRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'courier_deliveries';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  mapRow(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      subscription_id: row.subscription_id,
      user_id: row.user_id == null ? null : Number(row.user_id),
      stripe_account: row.stripe_account || null,
      stripe_invoice_id: row.stripe_invoice_id,
      method: row.method,
      courier_name: row.courier_name || null,
      tracking_url: row.tracking_url || null,
      cost_minor: row.cost_minor == null ? null : Number(row.cost_minor),
      currency: row.currency || 'brl',
      note: row.note || null,
      status: row.status,
      out_for_delivery_at: row.out_for_delivery_at || null,
      delivered_at: row.delivered_at || null,
      failed_at: row.failed_at || null,
      failure_reason: row.failure_reason || null,
      canceled_at: row.canceled_at || null,
      created_by: row.created_by == null ? null : Number(row.created_by),
      updated_by: row.updated_by == null ? null : Number(row.updated_by),
      created_at: row.created_at || null,
      updated_at: row.updated_at || null
    };
  }

  async select(where, params) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(`SELECT * FROM \`${this.tableName}\` WHERE ${where}`, params);
    return rowsOf(rows).map((row) => this.mapRow(row)).filter(Boolean);
  }

  // { inserted: false } when the invoice already has an active row (uq_courier_deliveries_active_invoice).
  async insert(payload) {
    this.ensureDataSource();
    let result;
    try {
      result = await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\` (
          \`subscription_id\`, \`user_id\`, \`stripe_account\`, \`stripe_invoice_id\`, \`method\`, \`courier_name\`,
          \`tracking_url\`, \`cost_minor\`, \`currency\`, \`note\`, \`status\`, \`out_for_delivery_at\`, \`created_by\`, \`updated_by\`
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'brl', ?, 'out_for_delivery', ?, ?, ?)`,
        [
          String(payload.subscriptionId),
          payload.userId == null ? null : Number(payload.userId),
          payload.stripeAccount || null,
          String(payload.invoiceId),
          payload.method,
          payload.courierName || null,
          payload.trackingUrl || null,
          payload.costMinor == null ? null : Number(payload.costMinor),
          payload.note || null,
          payload.outForDeliveryAt || new Date(),
          payload.actorId == null ? null : Number(payload.actorId),
          payload.actorId == null ? null : Number(payload.actorId)
        ]
      );
    } catch (error) {
      if (isDuplicateEntry(error)) return { inserted: false, row: null };
      throw error;
    }
    const insertId = Number(result?.insertId || result?.[0]?.insertId || 0);
    return { inserted: true, row: await this.findById(insertId) };
  }

  async findById(id) {
    const [row] = await this.select('`id` = ? LIMIT 1', [Number(id)]);
    return row || null;
  }

  async listBySubscriptionId(subscriptionId) {
    return this.select('`subscription_id` = ? ORDER BY `id` DESC', [String(subscriptionId)]);
  }

  async listByInvoiceIds(invoiceIds) {
    const ids = cleanIds(invoiceIds);
    if (!ids.length) return [];
    return this.select(`\`stripe_invoice_id\` IN (${ids.map(() => '?').join(', ')}) ORDER BY \`id\` DESC`, ids);
  }

  async listByStatus(status) {
    return this.select('`status` = ? ORDER BY `out_for_delivery_at` ASC, `id` ASC', [String(status)]);
  }

  async listDeliveredSince(since) {
    return this.select("`status` = 'delivered' AND `delivered_at` >= ? ORDER BY `delivered_at` DESC, `id` DESC", [since]);
  }

  // Only a row still out for delivery can reach a final status. Returns the affected rows: 0 when it was
  // already final, so two racing changes give one winner.
  async transition(id, toStatus, fields = {}) {
    this.ensureDataSource();
    const dateColumn = STATUS_DATE_COLUMN[toStatus];
    if (!dateColumn) throw new Error(`Unknown courier status ${toStatus}.`);
    const sets = ['`status` = ?', `\`${dateColumn}\` = ?`, '`updated_by` = ?'];
    const params = [toStatus, fields.at || new Date(), fields.actorId == null ? null : Number(fields.actorId)];
    if (toStatus === 'failed') {
      sets.push('`failure_reason` = ?');
      params.push(fields.reason || null);
    }
    params.push(Number(id));
    const result = await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET ${sets.join(', ')} WHERE \`id\` = ? AND \`status\` = 'out_for_delivery'`,
      params
    );
    return affectedRows(result);
  }

  // Edits never touch the status or a stage date, and a canceled row is closed.
  async updateDetails(id, details = {}, actorId = null) {
    this.ensureDataSource();
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(DETAIL_COLUMNS)) {
      if (details[key] === undefined) continue;
      sets.push(`\`${column}\` = ?`);
      params.push(details[key] === '' ? null : details[key]);
    }
    sets.push('`updated_by` = ?');
    params.push(actorId == null ? null : Number(actorId), Number(id));
    const result = await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET ${sets.join(', ')} WHERE \`id\` = ? AND \`status\` <> 'canceled'`,
      params
    );
    return affectedRows(result);
  }
}

module.exports = {
  ACTIVE_STATUSES,
  CourierDeliveryRepository,
  FINAL_STATUSES
};
