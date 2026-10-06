const TABLE_NAME = 'ups_shipments';
const COLUMN = 'active_invoice_id';
const INDEX = 'uq_ups_shipments_active_invoice';

// One shipment per invoice that is not voided, so two concurrent requests cannot both buy a label.
// MySQL has no partial index; a stored generated column is NULL for voided rows and UNIQUE ignores NULL.
// getTable() is not used: TypeORM then looks for typeorm_metadata, which a raw generated column never creates.
async function hasIndex(queryRunner) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [TABLE_NAME, INDEX]
  );
  return rows.length > 0;
}

class AddUpsShipmentsActiveInvoiceUnique1700000000030 {
  name = 'AddUpsShipmentsActiveInvoiceUnique1700000000030';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    const duplicated = await queryRunner.query(
      `SELECT stripe_invoice_id FROM ${TABLE_NAME} WHERE status <> 'voided' GROUP BY stripe_invoice_id HAVING COUNT(*) > 1 LIMIT 1`
    );
    if (duplicated.length > 0) {
      throw new Error(`${this.name}.up: invoice ${duplicated[0].stripe_invoice_id} has more than one shipment that is not voided; void the extra label in UPS and set its row to voided before migrating.`);
    }
    if (!(await queryRunner.hasColumn(TABLE_NAME, COLUMN))) {
      await queryRunner.query(
        `ALTER TABLE ${TABLE_NAME} ADD COLUMN ${COLUMN} VARCHAR(191)
          GENERATED ALWAYS AS (CASE WHEN status = 'voided' THEN NULL ELSE stripe_invoice_id END) STORED`
      );
    }
    if (!(await hasIndex(queryRunner))) {
      await queryRunner.query(`CREATE UNIQUE INDEX ${INDEX} ON ${TABLE_NAME} (${COLUMN})`);
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    if (await hasIndex(queryRunner)) {
      await queryRunner.query(`DROP INDEX ${INDEX} ON ${TABLE_NAME}`);
    }
    if (await queryRunner.hasColumn(TABLE_NAME, COLUMN)) {
      await queryRunner.query(`ALTER TABLE ${TABLE_NAME} DROP COLUMN ${COLUMN}`);
    }
  }
}

module.exports = {
  AddUpsShipmentsActiveInvoiceUnique1700000000030
};
