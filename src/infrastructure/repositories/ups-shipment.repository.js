const { HttpError } = require('../../core/http-error');

class UpsShipmentRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'ups_shipments';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  mapRow(row) {
    if (!row) {
      return null;
    }
    let rawResponse = null;
    if (row.raw_response) {
      try {
        rawResponse = typeof row.raw_response === 'string' ? JSON.parse(row.raw_response) : row.raw_response;
      } catch (_error) {
        rawResponse = null;
      }
    }
    return {
      id: Number(row.id),
      subscription_id: row.subscription_id,
      stripe_invoice_id: row.stripe_invoice_id,
      user_id: row.user_id == null ? null : Number(row.user_id),
      ups_shipment_id: row.ups_shipment_id || null,
      tracking_number: row.tracking_number || null,
      service_code: row.service_code || null,
      label_format: row.label_format || null,
      label_path: row.label_path || null,
      quoted_shipping_cost: row.quoted_shipping_cost == null ? null : Number(row.quoted_shipping_cost),
      ups_monetary_value: row.ups_monetary_value == null ? null : Number(row.ups_monetary_value),
      status: row.status,
      shipped_at: row.shipped_at || null,
      raw_response: rawResponse,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  async findActiveByInvoiceId(invoiceId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`stripe_invoice_id\` = ? AND \`status\` IN ('pending', 'created') ORDER BY \`id\` DESC LIMIT 1`,
      [String(invoiceId)]
    );
    return this.mapRow(Array.isArray(rows) ? rows[0] : null);
  }

  async findById(id) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`id\` = ? LIMIT 1`,
      [Number(id)]
    );
    return this.mapRow(Array.isArray(rows) ? rows[0] : null);
  }

  async findByUpsShipmentId(upsShipmentId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`ups_shipment_id\` = ? LIMIT 1`,
      [String(upsShipmentId)]
    );
    return this.mapRow(Array.isArray(rows) ? rows[0] : null);
  }

  async listBySubscriptionId(subscriptionId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`subscription_id\` = ? ORDER BY \`id\` DESC`,
      [String(subscriptionId)]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row));
  }

  async listByInvoiceIds(invoiceIds = []) {
    this.ensureDataSource();
    const ids = (invoiceIds || []).map((id) => String(id || '').trim()).filter(Boolean);
    if (!ids.length) {
      return [];
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`stripe_invoice_id\` IN (${placeholders}) AND \`status\` = 'created'`,
      ids
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row));
  }

  async insertPending({ subscriptionId, invoiceId, userId, quotedShippingCost }) {
    this.ensureDataSource();
    const result = await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (
        \`subscription_id\`, \`stripe_invoice_id\`, \`user_id\`, \`quoted_shipping_cost\`, \`status\`
      ) VALUES (?, ?, ?, ?, 'pending')`,
      [
        String(subscriptionId),
        String(invoiceId),
        userId == null ? null : Number(userId),
        quotedShippingCost == null ? null : Number(quotedShippingCost)
      ]
    );
    const insertId = Number(result?.insertId || result?.[0]?.insertId || 0);
    return this.findById(insertId);
  }

  async markCreated(id, payload = {}) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET
        \`ups_shipment_id\` = ?,
        \`tracking_number\` = ?,
        \`service_code\` = ?,
        \`label_format\` = ?,
        \`label_path\` = ?,
        \`ups_monetary_value\` = ?,
        \`status\` = 'created',
        \`shipped_at\` = COALESCE(\`shipped_at\`, CURRENT_TIMESTAMP),
        \`raw_response\` = ?
      WHERE \`id\` = ?`,
      [
        payload.upsShipmentId || null,
        payload.trackingNumber || null,
        payload.serviceCode || null,
        payload.labelFormat || null,
        payload.labelPath || null,
        payload.upsMonetaryValue == null ? null : Number(payload.upsMonetaryValue),
        payload.rawResponse == null ? null : JSON.stringify(payload.rawResponse),
        Number(id)
      ]
    );
    return this.findById(id);
  }

  async markVoided(id) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`status\` = 'voided' WHERE \`id\` = ?`,
      [Number(id)]
    );
    return this.findById(id);
  }

  async deletePending(id) {
    this.ensureDataSource();
    await this.dataSource.query(
      `DELETE FROM \`${this.tableName}\` WHERE \`id\` = ? AND \`status\` = 'pending'`,
      [Number(id)]
    );
  }

  async updateTracking(id, trackingNumber, rawResponse = null) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`tracking_number\` = ?, \`raw_response\` = COALESCE(?, \`raw_response\`) WHERE \`id\` = ?`,
      [
        trackingNumber || null,
        rawResponse == null ? null : JSON.stringify(rawResponse),
        Number(id)
      ]
    );
    return this.findById(id);
  }
}

module.exports = {
  UpsShipmentRepository
};
