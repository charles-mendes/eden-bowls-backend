const STATE_TABLE = 'onboarding_user_state';
const USERMETA_TABLE = 'wp_usermeta';
const PROFILE_MARKET_META_KEY = 'hsr_market_country';

// Checkouts whose row was created by a step other than the address never got a market. Fill them from the
// customer's profile market; a customer without one keeps an empty market and only admins see the checkout.
class BackfillOnboardingUserStateMarket1700000000056 {
  name = 'BackfillOnboardingUserStateMarket1700000000056';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(STATE_TABLE)) || !(await queryRunner.hasTable(USERMETA_TABLE))) {
      return;
    }
    await queryRunner.query(
      `UPDATE \`${STATE_TABLE}\` s
        JOIN \`${USERMETA_TABLE}\` pm ON pm.user_id = s.user_id AND pm.meta_key = ?
        SET s.market = UPPER(TRIM(pm.meta_value))
        WHERE (s.market IS NULL OR s.market = '') AND UPPER(TRIM(pm.meta_value)) IN ('BR', 'US')`,
      [PROFILE_MARKET_META_KEY]
    );
  }

  // The filled markets are indistinguishable from the ones written at checkout, so there is nothing to undo.
  async down() {}
}

module.exports = {
  BackfillOnboardingUserStateMarket1700000000056
};
