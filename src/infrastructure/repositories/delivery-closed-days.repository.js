const {
  buildBrazilHolidayRows,
  rowType,
  yearHasBrazilNationalRows
} = require('../../core/delivery-closed-days');

function bit(value) {
  return value ? 1 : 0;
}

function mapRow(row) {
  return {
    ...(row.id == null ? {} : { id: Number(row.id) }),
    market: row.market,
    closedOn: String(row.closedOn).slice(0, 10),
    label: row.label,
    origin: row.origin,
    type: row.type,
    active: row.active === true || row.active === 1,
    closesPreparation: row.closesPreparation === true || row.closesPreparation === 1,
    closesPickup: row.closesPickup === true || row.closesPickup === 1,
    closesDelivery: row.closesDelivery === true || row.closesDelivery === 1
  };
}

class DeliveryClosedDaysRepository {
  constructor(dataSource) {
    this.dataSource = dataSource;
  }

  async listActive(executor) {
    const rows = await (executor || this.dataSource).query(
      `SELECT id,
              market,
              DATE_FORMAT(closed_on, '%Y-%m-%d') AS closedOn,
              label,
              origin,
              type,
              active,
              closes_preparation AS closesPreparation,
              closes_pickup AS closesPickup,
              closes_delivery AS closesDelivery
         FROM delivery_closed_days
        WHERE active = 1`
    );
    return rows.map(mapRow);
  }

  // Every row of one market and year, inactive ones included, for the panel.
  async listYear(market, year, executor) {
    const rows = await (executor || this.dataSource).query(
      `SELECT id,
              market,
              DATE_FORMAT(closed_on, '%Y-%m-%d') AS closedOn,
              label,
              origin,
              type,
              active,
              closes_preparation AS closesPreparation,
              closes_pickup AS closesPickup,
              closes_delivery AS closesDelivery
         FROM delivery_closed_days
        WHERE market = ? AND closed_on >= ? AND closed_on < ?
        ORDER BY closed_on, type`,
      [market, `${year}-01-01`, `${Number(year) + 1}-01-01`]
    );
    return rows.map(mapRow);
  }

  async findById(id, executor) {
    const db = executor || this.dataSource;
    const rows = await db.query(
      `SELECT id,
              market,
              DATE_FORMAT(closed_on, '%Y-%m-%d') AS closedOn,
              label,
              origin,
              type,
              active,
              closes_preparation AS closesPreparation,
              closes_pickup AS closesPickup,
              closes_delivery AS closesDelivery
         FROM delivery_closed_days
        WHERE id = ?`,
      [id]
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async insertRow(executor, row) {
    const result = await executor.query(
      `INSERT INTO delivery_closed_days
        (market, closed_on, label, origin, type, active, closes_preparation, closes_pickup, closes_delivery)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.market,
        row.closedOn,
        row.label,
        row.origin,
        row.type,
        bit(row.active),
        bit(row.closesPreparation),
        bit(row.closesPickup),
        bit(row.closesDelivery)
      ]
    );
    return { ...row, id: Number(result.insertId) };
  }

  async updateRow(executor, row) {
    await executor.query(
      `UPDATE delivery_closed_days
          SET active = ?, closes_preparation = ?, closes_pickup = ?, closes_delivery = ?
        WHERE id = ?`,
      [bit(row.active), bit(row.closesPreparation), bit(row.closesPickup), bit(row.closesDelivery), row.id]
    );
    return row;
  }

  async deleteRow(executor, id) {
    await executor.query('DELETE FROM delivery_closed_days WHERE id = ?', [id]);
  }

  async insertIgnore(item) {
    await this.dataSource.query(
      `INSERT IGNORE INTO delivery_closed_days
        (market, closed_on, label, origin, type, active, closes_preparation, closes_pickup, closes_delivery)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        item.market,
        String(item.closedOn).slice(0, 10),
        item.label,
        item.origin,
        rowType(item),
        bit(item.closesPreparation),
        bit(item.closesPickup),
        bit(item.closesDelivery)
      ]
    );
  }

  async deleteOne(market, closedOn, type) {
    await this.dataSource.query(
      'DELETE FROM delivery_closed_days WHERE market = ? AND closed_on = ? AND type = ?',
      [market, String(closedOn).slice(0, 10), type]
    );
  }

  async ensureBrazilYear(year) {
    const rows = await this.listActive();
    if (yearHasBrazilNationalRows(rows, year)) {
      return { generated: false };
    }
    for (const item of buildBrazilHolidayRows(year)) {
      await this.insertIgnore(item);
    }
    return { generated: true };
  }
}

module.exports = {
  DeliveryClosedDaysRepository
};
