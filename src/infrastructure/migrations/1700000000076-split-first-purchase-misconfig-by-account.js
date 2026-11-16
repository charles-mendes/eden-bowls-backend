const METRICS = 'stripe_first_purchase_promo_metrics';

// first-purchase-misconfig-per-account: the blocked-checkout counter moves to one row per Stripe account
// (`misconfig_count:us`, `misconfig_count:br`). The old global row cannot be split between accounts, so it is dropped.
class SplitFirstPurchaseMisconfigByAccount1700000000076 {
  name = 'SplitFirstPurchaseMisconfigByAccount1700000000076';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(METRICS))) return;
    await queryRunner.query(`DELETE FROM \`${METRICS}\` WHERE \`metric_key\` = 'misconfig_count'`);
  }

  // The dropped count is not restored: nobody can tell how many of the per-account ones came before.
  async down() {}
}

module.exports = {
  SplitFirstPurchaseMisconfigByAccount1700000000076
};
