const { HttpError } = require('../../core/http-error');

const ACTIVE_STATUSES = ['pending', 'requested', 'unknown'];
// A label joins a pickup only while created, with no tracking scan: the condition Today counts with (ups-pickup).
const FREE_LABEL = "`status` = 'created' AND `pickup_id` IS NULL AND `in_transit_at` IS NULL AND `out_for_delivery_at` IS NULL";

function affectedRows(result) {
  if (result && typeof result.affectedRows === 'number') return result.affectedRows;
  if (Array.isArray(result) && result[0] && typeof result[0].affectedRows === 'number') return result[0].affectedRows;
  if (Array.isArray(result) && typeof result[1] === 'number') return result[1];
  return 0;
}

function insertId(result) {
  return Number((result && result.insertId) || (Array.isArray(result) && result[0] && result[0].insertId) || 0);
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function dateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// UPS on-demand pickups (ups-pickup). A label belongs to at most one active pickup: `ups_shipments.pickup_id` is
// set by a conditional UPDATE inside the transaction that inserts the pickup, and goes back to NULL on release.
class UpsPickupRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'ups_pickups';
    this.shipmentsTableName = options.shipmentsTableName || 'ups_shipments';
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
      pickup_date: dateKey(row.pickup_date),
      ready_time: row.ready_time,
      close_time: row.close_time,
      package_count: Number(row.package_count),
      status: row.status,
      prn: row.prn || null,
      shipment_ids: (parseJson(row.shipment_ids, []) || []).map(Number),
      requested_by: row.requested_by || null,
      closed_by: row.closed_by || null,
      closed_at: row.closed_at || null,
      last_error: row.last_error || null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  // Inserts the pickup as pending and links every label to it, or nothing. Returns { pickup } when every id was a
  // created label without an active pickup, or { pickup: null, ineligibleIds } after undoing the insert.
  async reserve({ pickupDate, readyTime, closeTime, packageCount, shipmentIds, requestedBy }) {
    this.ensureDataSource();
    const ids = [...new Set((shipmentIds || []).map(Number))];
    const placeholders = ids.map(() => '?').join(', ');
    let pickupId = null;
    try {
      await this.dataSource.transaction(async (manager) => {
        const inserted = await manager.query(
          `INSERT INTO \`${this.tableName}\`
            (\`pickup_date\`, \`ready_time\`, \`close_time\`, \`package_count\`, \`status\`, \`shipment_ids\`, \`requested_by\`)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
          [pickupDate, readyTime, closeTime, Number(packageCount), JSON.stringify(ids), requestedBy || null]
        );
        pickupId = insertId(inserted);
        const linked = await manager.query(
          `UPDATE \`${this.shipmentsTableName}\` SET \`pickup_id\` = ?
            WHERE \`id\` IN (${placeholders}) AND ${FREE_LABEL}`,
          [pickupId, ...ids]
        );
        if (affectedRows(linked) !== ids.length) {
          const error = new Error('pickup_reservation_partial');
          error.pickupReservationPartial = true;
          throw error;
        }
      });
    } catch (error) {
      if (!error || !error.pickupReservationPartial) throw error;
      const free = await this.dataSource.query(
        `SELECT \`id\` FROM \`${this.shipmentsTableName}\`
          WHERE \`id\` IN (${placeholders}) AND ${FREE_LABEL}`,
        ids
      );
      const freeIds = new Set((free || []).map((row) => Number(row.id)));
      return { pickup: null, ineligibleIds: ids.filter((id) => !freeIds.has(id)) };
    }
    return { pickup: await this.findById(pickupId) };
  }

  async markRequested(id, { prn, rawResponse }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`status\` = 'requested', \`prn\` = ?, \`raw_response\` = ?, \`last_error\` = NULL
        WHERE \`id\` = ? AND \`status\` IN ('pending', 'unknown')`,
      [prn, rawResponse == null ? null : JSON.stringify(rawResponse), Number(id)]
    );
    return this.findById(id);
  }

  async markUnknown(id, lastError) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`status\` = 'unknown', \`last_error\` = ? WHERE \`id\` = ? AND \`status\` = 'pending'`,
      [lastError ? String(lastError).slice(0, 500) : null, Number(id)]
    );
    return this.findById(id);
  }

  // A pickup UPS refused: the reservation goes away and the labels are free again.
  async deleteReservation(id) {
    this.ensureDataSource();
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`UPDATE \`${this.shipmentsTableName}\` SET \`pickup_id\` = NULL WHERE \`pickup_id\` = ?`, [Number(id)]);
      await manager.query(`DELETE FROM \`${this.tableName}\` WHERE \`id\` = ? AND \`status\` = 'pending'`, [Number(id)]);
    });
  }

  // Closes a pickup (canceled or not_created) only from `fromStatus`, and frees its labels in the same transaction.
  // `pendingBefore` also accepts a `pending` reservation older than that date (left behind, see ups-pickup-status).
  // Returns false when another request already moved it.
  async close(id, { fromStatus, toStatus, closedBy, pendingBefore = null }) {
    this.ensureDataSource();
    let closed = false;
    await this.dataSource.transaction(async (manager) => {
      const stale = pendingBefore ? " OR (`status` = 'pending' AND `created_at` < ?)" : '';
      const result = await manager.query(
        `UPDATE \`${this.tableName}\` SET \`status\` = ?, \`closed_by\` = ?, \`closed_at\` = CURRENT_TIMESTAMP
          WHERE \`id\` = ? AND (\`status\` = ?${stale})`,
        [toStatus, closedBy || null, Number(id), fromStatus, ...(pendingBefore ? [pendingBefore] : [])]
      );
      closed = affectedRows(result) === 1;
      if (closed) {
        await manager.query(`UPDATE \`${this.shipmentsTableName}\` SET \`pickup_id\` = NULL WHERE \`pickup_id\` = ?`, [Number(id)]);
      }
    });
    return closed;
  }

  async findById(id) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(`SELECT * FROM \`${this.tableName}\` WHERE \`id\` = ? LIMIT 1`, [Number(id)]);
    return this.mapRow(Array.isArray(rows) ? rows[0] : null);
  }

  // Newest pickup date first, from a New York date key. A reservation in progress is listed as pending.
  async list({ from }) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`pickup_date\` >= ?
        ORDER BY \`pickup_date\` DESC, \`id\` DESC LIMIT 200`,
      [from]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row));
  }

  // The active pickups among these ids, for the label queue.
  async listActiveByIds(ids = []) {
    this.ensureDataSource();
    const list = [...new Set((ids || []).map(Number).filter((id) => id > 0))];
    if (!list.length) return [];
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`id\` IN (${list.map(() => '?').join(', ')}) AND \`status\` IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})`,
      [...list, ...ACTIVE_STATUSES]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row));
  }
}

module.exports = { UpsPickupRepository, ACTIVE_STATUSES, FREE_LABEL };
