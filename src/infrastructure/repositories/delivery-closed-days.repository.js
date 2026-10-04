const {
  buildBrazilHolidayRows,
  yearHasBrazilNationalRows
} = require('../../core/delivery-closed-days');

function bit(value) {
  return value ? 1 : 0;
}

function mapRow(row) {
  return {
    market: row.market,
    closedOn: String(row.closedOn).slice(0, 10),
    label: row.label,
    origin: row.origin,
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

  async listActive() {
    const rows = await this.dataSource.query(
      `SELECT market,
              DATE_FORMAT(closed_on, '%Y-%m-%d') AS closedOn,
              label,
              origin,
              active,
              closes_preparation AS closesPreparation,
              closes_pickup AS closesPickup,
              closes_delivery AS closesDelivery
         FROM delivery_closed_days
        WHERE active = 1`
    );
    return rows.map(mapRow);
  }

  async insertIgnore(item) {
    await this.dataSource.query(
      `INSERT IGNORE INTO delivery_closed_days
        (market, closed_on, label, origin, active, closes_preparation, closes_pickup, closes_delivery)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        item.market,
        String(item.closedOn).slice(0, 10),
        item.label,
        item.origin,
        bit(item.closesPreparation),
        bit(item.closesPickup),
        bit(item.closesDelivery)
      ]
    );
  }

  async deleteOne(market, closedOn) {
    await this.dataSource.query(
      'DELETE FROM delivery_closed_days WHERE market = ? AND closed_on = ?',
      [market, String(closedOn).slice(0, 10)]
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
