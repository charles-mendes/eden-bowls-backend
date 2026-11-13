const { HttpError } = require('../../core/http-error');

function isDuplicateEntry(error) {
  return Boolean(error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062));
}

class UpsShipmentRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'ups_shipments';
    this.packagesTableName = options.packagesTableName || 'ups_shipment_packages';
  }

  mapPackageRow(row) {
    return {
      shipment_id: Number(row.shipment_id),
      sequence: Number(row.sequence),
      box_key: row.box_key || null,
      pack_count: Number(row.pack_count) || 0,
      weight_lb: row.weight_lb == null ? null : Number(row.weight_lb),
      dry_ice_kg: row.dry_ice_kg == null ? null : Number(row.dry_ice_kg),
      tracking_number: row.tracking_number || null,
      label_path: row.label_path || null
    };
  }

  // One row per UPS package of a label (shipping-boxes), sequence from 1 in the order UPS was sent them.
  async insertPackages(shipmentId, packages = []) {
    this.ensureDataSource();
    if (!packages.length) {
      return;
    }
    const params = packages.flatMap((pkg) => [
      Number(shipmentId),
      Number(pkg.sequence),
      pkg.boxKey || null,
      Number(pkg.packCount) || 0,
      Number(pkg.weightLb),
      pkg.dryIceKg == null ? null : Number(pkg.dryIceKg),
      pkg.trackingNumber || null,
      pkg.labelPath || null
    ]);
    await this.dataSource.query(
      `INSERT INTO \`${this.packagesTableName}\` (
        \`shipment_id\`, \`sequence\`, \`box_key\`, \`pack_count\`, \`weight_lb\`, \`dry_ice_kg\`, \`tracking_number\`, \`label_path\`
      ) VALUES ${packages.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      params
    );
  }

  async listPackagesByShipmentIds(shipmentIds = []) {
    this.ensureDataSource();
    const ids = [...new Set((shipmentIds || []).map(Number).filter((id) => id > 0))];
    if (!ids.length) {
      return [];
    }
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.packagesTableName}\` WHERE \`shipment_id\` IN (${ids.map(() => '?').join(', ')}) ORDER BY \`shipment_id\`, \`sequence\``,
      ids
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapPackageRow(row));
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
      tracking_status: row.tracking_status || null,
      tracking_description: row.tracking_description || null,
      tracking_checked_at: row.tracking_checked_at || null,
      in_transit_at: row.in_transit_at || null,
      out_for_delivery_at: row.out_for_delivery_at || null,
      delivered_at: row.delivered_at || null,
      shipped_letter_sent_at: row.shipped_letter_sent_at || null,
      shipped_at: row.shipped_at || null,
      pickup_id: row.pickup_id == null ? null : Number(row.pickup_id),
      raw_response: rawResponse,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  async findActiveByInvoiceId(invoiceId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`stripe_invoice_id\` = ? AND \`status\` <> 'voided' ORDER BY \`id\` DESC LIMIT 1`,
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
      `SELECT * FROM \`${this.tableName}\` WHERE \`stripe_invoice_id\` IN (${placeholders}) AND \`status\` IN ('created', 'delivered')`,
      ids
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row));
  }

  // Purchases UPS never confirmed (pending or unknown), for Today.
  async countUnresolved() {
    this.ensureDataSource();
    const rows = await this.dataSource.query(`SELECT COUNT(*) AS total FROM \`${this.tableName}\` WHERE \`status\` IN ('pending', 'unknown')`);
    return Number((Array.isArray(rows) && rows[0] && rows[0].total) || 0);
  }

  // Created labels with no active pickup and no tracking scan yet, for Today (ups-pickup).
  async countCreatedWithoutPickup() {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM \`${this.tableName}\`
        WHERE \`status\` = 'created' AND \`pickup_id\` IS NULL AND \`in_transit_at\` IS NULL AND \`out_for_delivery_at\` IS NULL`
    );
    return Number((Array.isArray(rows) && rows[0] && rows[0].total) || 0);
  }

  // Every row that still holds its invoice: pending, unknown, created or delivered.
  async listActiveByInvoiceIds(invoiceIds = []) {
    this.ensureDataSource();
    const ids = (invoiceIds || []).map((id) => String(id || '').trim()).filter(Boolean);
    if (!ids.length) {
      return [];
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`stripe_invoice_id\` IN (${placeholders}) AND \`status\` <> 'voided'`,
      ids
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row));
  }

  // Returns null when another row that is not voided already holds this invoice (uq_ups_shipments_active_invoice).
  async insertPending({ subscriptionId, invoiceId, userId, quotedShippingCost }) {
    this.ensureDataSource();
    let result;
    try {
      result = await this.dataSource.query(
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
    } catch (error) {
      if (isDuplicateEntry(error)) {
        return null;
      }
      throw error;
    }
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

  // UPS may have bought the label, so the row stays and blocks a second purchase for the invoice.
  async markUnknown(id) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`status\` = 'unknown' WHERE \`id\` = ? AND \`status\` = 'pending'`,
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

  // Only a label in the 'created' state becomes delivered, so a voided row stays voided.
  // Stage dates keep the first scan: a later read never moves them (delivery-tracking).
  async recordTracking(id, summary, rawResponse = null) {
    this.ensureDataSource();
    const tracking = summary || {};
    const stages = tracking.stages || {};
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET
        \`tracking_status\` = COALESCE(?, \`tracking_status\`),
        \`tracking_description\` = COALESCE(?, \`tracking_description\`),
        \`in_transit_at\` = COALESCE(\`in_transit_at\`, ?),
        \`out_for_delivery_at\` = COALESCE(\`out_for_delivery_at\`, ?),
        \`delivered_at\` = COALESCE(\`delivered_at\`, ?),
        \`tracking_response\` = COALESCE(?, \`tracking_response\`),
        \`tracking_checked_at\` = CURRENT_TIMESTAMP,
        \`status\` = CASE WHEN ? = 'delivered' AND \`status\` = 'created' THEN 'delivered' ELSE \`status\` END
      WHERE \`id\` = ?`,
      [
        tracking.status || null,
        tracking.description || null,
        stages.in_transit || null,
        stages.out_for_delivery || null,
        tracking.deliveredAt || stages.delivered || null,
        rawResponse == null ? null : JSON.stringify(rawResponse),
        tracking.status || null,
        Number(id)
      ]
    );
    return this.findById(id);
  }

  // A failed read also moves the row to the end of the queue, so it cannot hold the batch.
  async markTrackingChecked(id) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`tracking_checked_at\` = CURRENT_TIMESTAMP WHERE \`id\` = ?`,
      [Number(id)]
    );
  }

  async markShippedLetterSent(id) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`shipped_letter_sent_at\` = COALESCE(\`shipped_letter_sent_at\`, CURRENT_TIMESTAMP) WHERE \`id\` = ?`,
      [Number(id)]
    );
  }

  // delivered_at is the UPS local time, so the 7 days are approximate by a few hours.
  async listDeliveredAwaitingLetter(limit) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      [
        `SELECT * FROM \`${this.tableName}\``,
        "WHERE `status` = 'delivered' AND `shipped_letter_sent_at` IS NULL",
        'AND `delivered_at` >= (CURRENT_TIMESTAMP - INTERVAL 7 DAY)',
        'ORDER BY `id` ASC',
        'LIMIT ?'
      ].join(' '),
      [limit]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row)).filter(Boolean);
  }

  async listOpenForTracking(limit) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      [
        `SELECT * FROM \`${this.tableName}\``,
        "WHERE `tracking_number` IS NOT NULL AND `tracking_number` <> ''",
        "AND `status` NOT IN ('delivered', 'voided')",
        // MySQL sorts NULL first, so a shipment never read goes before the rest.
        'ORDER BY `tracking_checked_at` ASC, `id` ASC',
        'LIMIT ?'
      ].join(' '),
      [limit]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row)).filter(Boolean);
  }
}

module.exports = {
  UpsShipmentRepository
};
