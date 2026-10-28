const { HttpError } = require('../../core/http-error');

const SEPARATION_TYPES = ['separation', 'separation_reversal'];

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return Boolean(
    error && (
      error.code === 'ER_NO_SUCH_TABLE' ||
      error.errno === 1146 ||
      /doesn't exist/i.test(message)
    )
  );
}

function itemKey({ market, flavorKey, packSizeGrams }) {
  return `${market}|${flavorKey}|${packSizeGrams}`;
}

function compareKeys(left, right) {
  if (left.market !== right.market) return left.market < right.market ? -1 : 1;
  if (left.flavorKey !== right.flavorKey) return left.flavorKey < right.flavorKey ? -1 : 1;
  return left.packSizeGrams - right.packSizeGrams;
}

function mapItem(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    market: String(row.market),
    flavorKey: String(row.flavor_key),
    packSizeGrams: Number(row.pack_size_grams),
    onHand: Number(row.on_hand || 0),
    minLevel: row.min_level == null ? null : Number(row.min_level),
    updatedAt: row.updated_at || null
  };
}

function mapMovement(row) {
  return {
    id: Number(row.id),
    market: String(row.market),
    flavorKey: String(row.flavor_key),
    packSizeGrams: Number(row.pack_size_grams),
    type: String(row.type),
    quantity: Number(row.quantity),
    reason: row.reason ? String(row.reason) : null,
    note: row.note ? String(row.note) : null,
    productionCycleId: row.production_cycle_id == null ? null : Number(row.production_cycle_id),
    subscriptionId: row.subscription_id == null ? null : Number(row.subscription_id),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    actorName: row.actor_name ? String(row.actor_name) : null,
    createdAt: row.created_at || null
  };
}

class PackStockRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.itemsTableName = options.itemsTableName || 'pack_stock_items';
    this.movementsTableName = options.movementsTableName || 'pack_stock_movements';
    this.usersTableName = options.usersTableName || 'wp_users';
    this.availability = null;
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  // Checked once per process, before any transaction: inside one, a missing-table error would already have
  // rolled back the production cycle change in MySQL. A migration rollback needs an API restart anyway.
  async isAvailable() {
    if (this.availability !== null) {
      return this.availability;
    }
    this.ensureDataSource();
    try {
      await this.dataSource.query(`SELECT 1 FROM \`${this.itemsTableName}\` LIMIT 0`);
      await this.dataSource.query(`SELECT 1 FROM \`${this.movementsTableName}\` LIMIT 0`);
      this.availability = true;
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
      this.availability = false;
    }
    return this.availability;
  }

  async transaction(work) {
    this.ensureDataSource();
    return this.dataSource.transaction(work);
  }

  // Locks each item in key order (creating the missing ones), writes the movements and moves `on_hand` by their
  // sum. Returns the touched items after the change.
  async applyMovements(manager, movements = []) {
    const runner = manager || this.dataSource;
    const byKey = new Map();
    for (const movement of movements) {
      const key = itemKey(movement);
      const entry = byKey.get(key) || { key: movement, movements: [] };
      entry.movements.push(movement);
      byKey.set(key, entry);
    }

    const touched = [];
    for (const entry of [...byKey.values()].sort((left, right) => compareKeys(left.key, right.key))) {
      const { market, flavorKey, packSizeGrams } = entry.key;
      await runner.query(
        `INSERT IGNORE INTO \`${this.itemsTableName}\` (\`market\`, \`flavor_key\`, \`pack_size_grams\`) VALUES (?, ?, ?)`,
        [market, flavorKey, packSizeGrams]
      );
      const rows = await runner.query(
        `SELECT * FROM \`${this.itemsTableName}\` WHERE \`market\` = ? AND \`flavor_key\` = ? AND \`pack_size_grams\` = ? FOR UPDATE`,
        [market, flavorKey, packSizeGrams]
      );
      const item = mapItem(Array.isArray(rows) ? rows[0] : null);
      if (!item) {
        throw new HttpError(500, 'Stock item could not be locked.');
      }

      let delta = 0;
      for (const movement of entry.movements) {
        await runner.query(
          `INSERT INTO \`${this.movementsTableName}\`
            (\`item_id\`, \`type\`, \`quantity\`, \`reason\`, \`note\`, \`production_cycle_id\`, \`subscription_id\`, \`actor_user_id\`)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            movement.type,
            movement.quantity,
            movement.reason || null,
            movement.note || null,
            movement.productionCycleId == null ? null : movement.productionCycleId,
            movement.subscriptionId == null ? null : movement.subscriptionId,
            movement.actorUserId == null ? null : movement.actorUserId
          ]
        );
        delta += movement.quantity;
      }
      await runner.query(
        `UPDATE \`${this.itemsTableName}\` SET \`on_hand\` = \`on_hand\` + ? WHERE \`id\` = ?`,
        [delta, item.id]
      );
      touched.push({ ...item, onHand: item.onHand + delta });
    }
    return touched;
  }

  async listItems(market) {
    this.ensureDataSource();
    try {
      const rows = await this.dataSource.query(
        `SELECT * FROM \`${this.itemsTableName}\` WHERE \`market\` = ? ORDER BY \`flavor_key\` ASC, \`pack_size_grams\` ASC`,
        [market]
      );
      return (Array.isArray(rows) ? rows : []).map(mapItem);
    } catch (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  async findItem({ market, flavorKey, packSizeGrams }) {
    this.ensureDataSource();
    try {
      const rows = await this.dataSource.query(
        `SELECT * FROM \`${this.itemsTableName}\` WHERE \`market\` = ? AND \`flavor_key\` = ? AND \`pack_size_grams\` = ? LIMIT 1`,
        [market, flavorKey, packSizeGrams]
      );
      return mapItem(Array.isArray(rows) ? rows[0] : null);
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async listMovements({ market, flavorKey, packSizeGrams, type } = {}, { perPage = 20, offset = 0 } = {}) {
    this.ensureDataSource();
    const where = ['i.`market` = ?'];
    const params = [market];
    if (flavorKey) {
      where.push('i.`flavor_key` = ?');
      params.push(flavorKey);
    }
    if (packSizeGrams) {
      where.push('i.`pack_size_grams` = ?');
      params.push(packSizeGrams);
    }
    if (type) {
      where.push('m.`type` = ?');
      params.push(type);
    }
    const joinSql = `FROM \`${this.movementsTableName}\` m JOIN \`${this.itemsTableName}\` i ON i.\`id\` = m.\`item_id\``;
    const whereSql = `WHERE ${where.join(' AND ')}`;

    try {
      const [countRows, rows] = await Promise.all([
        this.dataSource.query(`SELECT COUNT(*) AS total ${joinSql} ${whereSql}`, params),
        this.dataSource.query(
          `SELECT m.*, i.\`market\`, i.\`flavor_key\`, i.\`pack_size_grams\`, u.\`display_name\` AS actor_name
            ${joinSql}
            LEFT JOIN \`${this.usersTableName}\` u ON u.\`ID\` = m.\`actor_user_id\`
            ${whereSql}
            ORDER BY m.\`created_at\` DESC, m.\`id\` DESC
            LIMIT ? OFFSET ?`,
          [...params, Number(perPage), Number(offset)]
        )
      ]);
      return {
        total: Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0),
        items: (Array.isArray(rows) ? rows : []).map(mapMovement)
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { total: 0, items: [] };
      }
      throw error;
    }
  }

  // What the cycle's open separation took per item: separations plus reversals, only where the sum is not zero.
  async openSeparationsForCycle(manager, cycleId) {
    const rows = await (manager || this.dataSource).query(
      `SELECT i.\`market\`, i.\`flavor_key\`, i.\`pack_size_grams\`, SUM(m.\`quantity\`) AS quantity
        FROM \`${this.movementsTableName}\` m
        JOIN \`${this.itemsTableName}\` i ON i.\`id\` = m.\`item_id\`
        WHERE m.\`production_cycle_id\` = ? AND m.\`type\` IN (?, ?)
        GROUP BY i.\`market\`, i.\`flavor_key\`, i.\`pack_size_grams\`
        HAVING SUM(m.\`quantity\`) <> 0`,
      [cycleId, ...SEPARATION_TYPES]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      market: String(row.market),
      flavorKey: String(row.flavor_key),
      packSizeGrams: Number(row.pack_size_grams),
      quantity: Number(row.quantity)
    }));
  }

  async setMinimum({ market, flavorKey, packSizeGrams, minLevel }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `INSERT INTO \`${this.itemsTableName}\` (\`market\`, \`flavor_key\`, \`pack_size_grams\`, \`min_level\`) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE \`min_level\` = VALUES(\`min_level\`)`,
      [market, flavorKey, packSizeGrams, minLevel == null ? null : minLevel]
    );
    return this.findItem({ market, flavorKey, packSizeGrams });
  }
}

module.exports = {
  PackStockRepository,
  isMissingTableError
};
