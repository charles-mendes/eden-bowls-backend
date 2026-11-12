const ISSUES = 'delivery_address_issues';
const LEDGER = 'stripe_subscriptions';
const CYCLES = 'subscription_production_cycles';
const COURIER = 'courier_deliveries';
const UPS = 'ups_shipments';

// close-address-issues-when-subscription-ends: problems left open by subscriptions that already ended close as
// `ended` when no paid box is left to ship. A frozen copy of DeliveryAddressIssuesRepository.closeEnded with no
// subscription filter: a migration must not change when the repository does. No email is sent.
class CloseAddressIssuesOfEndedSubscriptions1700000000072 {
  name = 'CloseAddressIssuesOfEndedSubscriptions1700000000072';

  async up(queryRunner) {
    for (const table of [ISSUES, LEDGER, CYCLES, COURIER, UPS]) {
      if (!(await queryRunner.hasTable(table))) return;
    }
    const same = (left, right) => `${left} COLLATE utf8mb4_unicode_ci = ${right} COLLATE utf8mb4_unicode_ci`;
    await queryRunner.query(
      `UPDATE \`${ISSUES}\` i JOIN \`${LEDGER}\` s ON s.id = i.subscription_id
       SET i.\`open_key\` = NULL, i.\`resolved_at\` = UTC_TIMESTAMP(), i.\`resolved_by\` = 'ended'
       WHERE i.\`open_key\` IS NOT NULL
         AND s.\`status\` = 'canceled'
         AND NOT EXISTS (SELECT 1 FROM \`${CYCLES}\` c
           WHERE c.subscription_id = s.id AND c.paid_at IS NOT NULL AND c.paid_invoice_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM \`${COURIER}\` cd WHERE ${same('cd.stripe_invoice_id', 'c.paid_invoice_id')} AND cd.status IN ('out_for_delivery', 'delivered'))
             AND NOT EXISTS (SELECT 1 FROM \`${UPS}\` us WHERE ${same('us.stripe_invoice_id', 'c.paid_invoice_id')} AND us.status IN ('created', 'delivered')))`
    );
  }

  // The closed problems cannot be told apart from later ones without guessing, so nothing is reopened.
  async down() {}
}

module.exports = { CloseAddressIssuesOfEndedSubscriptions1700000000072 };
