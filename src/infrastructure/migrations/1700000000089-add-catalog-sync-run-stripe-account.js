const TABLE = 'catalog_sync_runs';

// The id (acct_...) of the Stripe account a completed catalog sync ran against, so the checkout readiness check can
// tell a catalog synced on another account. Runs from before this migration keep it null.
class AddCatalogSyncRunStripeAccount1700000000089 {
  name = 'AddCatalogSyncRunStripeAccount1700000000089';

  async up(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && !(await queryRunner.hasColumn(TABLE, 'stripe_account_id'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`stripe_account_id\` VARCHAR(64) NULL`);
    }
  }

  async down(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && (await queryRunner.hasColumn(TABLE, 'stripe_account_id'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` DROP COLUMN \`stripe_account_id\``);
    }
  }
}

module.exports = {
  AddCatalogSyncRunStripeAccount1700000000089
};
