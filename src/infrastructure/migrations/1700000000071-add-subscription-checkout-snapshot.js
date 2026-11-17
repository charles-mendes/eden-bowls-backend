const { buildCheckoutSnapshot, sameJson } = require('../../core/checkout-snapshot');

const LEDGER = 'stripe_subscriptions';
const USER_STATE = 'onboarding_user_state';
const COLUMN = 'checkout_snapshot';

function parseJson(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return null;
  }
}

// checkout-history: the checkout frozen on each subscription, written once when the checkout creates it.
// The backfill fills only the subscription the customer's onboarding row still belongs to, and only when
// that row was not changed afterwards (a new draft or an edit): otherwise the old purchase stays partial.
class AddSubscriptionCheckoutSnapshot1700000000071 {
  name = 'AddSubscriptionCheckoutSnapshot1700000000071';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(LEDGER))) {
      return;
    }
    if (!(await queryRunner.hasColumn(LEDGER, COLUMN))) {
      await queryRunner.query(`ALTER TABLE \`${LEDGER}\` ADD COLUMN \`${COLUMN}\` JSON NULL`);
    }
    if (await queryRunner.hasTable(USER_STATE)) {
      await this.backfill(queryRunner);
    }
  }

  async backfill(queryRunner) {
    const rows = await queryRunner.query(
      [
        'SELECT s.`id`, s.`plan_selection` AS ledger_plan, s.`address` AS ledger_address, s.`shipping` AS ledger_shipping,',
        's.`pets_snapshot`, s.`subscription_term_months`,',
        'u.`checkout_reference`, u.`plan_selection`, u.`address`, u.`shipping`, u.`recurrence`',
        `FROM \`${LEDGER}\` s`,
        `INNER JOIN \`${USER_STATE}\` u ON u.\`user_id\` = s.\`user_id\``,
        `WHERE s.\`${COLUMN}\` IS NULL`,
        "AND JSON_UNQUOTE(JSON_EXTRACT(u.`checkout_reference`, '$.stripe_subscription_id')) = s.`stripe_subscription_id`"
      ].join(' ')
    );

    for (const row of Array.isArray(rows) ? rows : []) {
      const planSelection = parseJson(row.plan_selection);
      const address = parseJson(row.address);
      const shipping = parseJson(row.shipping);
      const untouched = sameJson(planSelection, parseJson(row.ledger_plan))
        && sameJson(address || {}, parseJson(row.ledger_address) || {})
        && sameJson(shipping || {}, parseJson(row.ledger_shipping) || {});
      if (!untouched) {
        continue;
      }
      const snapshot = buildCheckoutSnapshot({
        source: 'backfill',
        capturedAt: null,
        checkoutReference: parseJson(row.checkout_reference),
        planSelection,
        petsSnapshot: parseJson(row.pets_snapshot),
        address,
        shipping,
        recurrence: parseJson(row.recurrence),
        subscriptionTermMonths: row.subscription_term_months
      });
      await queryRunner.query(
        `UPDATE \`${LEDGER}\` SET \`${COLUMN}\` = ? WHERE \`id\` = ? AND \`${COLUMN}\` IS NULL`,
        [JSON.stringify(snapshot), row.id]
      );
    }
  }

  async down(queryRunner) {
    if ((await queryRunner.hasTable(LEDGER)) && (await queryRunner.hasColumn(LEDGER, COLUMN))) {
      await queryRunner.query(`ALTER TABLE \`${LEDGER}\` DROP COLUMN \`${COLUMN}\``);
    }
  }
}

module.exports = {
  AddSubscriptionCheckoutSnapshot1700000000071
};
