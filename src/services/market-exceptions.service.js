const { DateTime } = require('luxon');
const { HttpError } = require('../core/http-error');
const { constrainMarketQuery, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { storedCountry } = require('../core/shipment-market');
const { recipientDisplayName } = require('../core/production-queue-presenter');

const OPEN_DAYS = 30;
const LIMIT = 200;

// The subscriptions that ship from no market (shipment-market), for the panel to resolve by hand. A staff member
// scoped to markets sees only the accounts of those markets.
class MarketExceptionsService {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.courierTableName = options.courierTableName || 'courier_deliveries';
    this.upsTableName = options.upsTableName || 'ups_shipments';
    this.now = options.now || (() => new Date());
  }

  async list(actor = {}) {
    if (!this.ledgerRepository || typeof this.ledgerRepository.listMarketExceptions !== 'function') {
      throw new HttpError(503, 'Subscription ledger is not available.');
    }
    const stripeAccounts = shouldEnforceMarketScope(actor) ? constrainMarketQuery(actor, {}).stripeAccounts : null;
    const floor = DateTime.fromJSDate(this.now(), { zone: 'UTC' }).minus({ days: OPEN_DAYS }).toISODate();
    const rows = await this.ledgerRepository.listMarketExceptions({
      deliveryFloor: floor,
      limit: LIMIT + 1,
      stripeAccounts,
      courierTableName: this.courierTableName,
      upsTableName: this.upsTableName
    });
    return {
      success: true,
      data: {
        items: rows.slice(0, LIMIT).map((row) => ({
          subscription_id: String(row.id),
          stripe_subscription_id: row.stripeSubscriptionId,
          status: row.status,
          stripe_account: row.stripeAccount,
          address_country: storedCountry(row.address) || null,
          customer: {
            id: row.userId == null ? null : String(row.userId),
            email: row.customerEmail,
            name: recipientDisplayName(row.address, '') || null
          },
          open_paid_cycles: row.openPaidCycles
        })),
        truncated: rows.length > LIMIT
      }
    };
  }
}

module.exports = { MarketExceptionsService };
