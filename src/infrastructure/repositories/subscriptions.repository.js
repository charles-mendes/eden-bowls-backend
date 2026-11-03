const { mapLedgerToDashboardListItem } = require('../../core/subscription-dashboard');
const { dashboardPlanNotice } = require('../../core/plan-notice');

class SubscriptionsRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.settingsRepository = options.settingsRepository || null;
  }

  async listMine({ userId } = {}) {
    if (!this.ledgerRepository) {
      return { subscriptions: [], count: 0 };
    }

    const rows = await this.ledgerRepository.listByUserId(userId);
    const seen = new Set();
    const windows = new Map();
    const subscriptions = [];

    for (const row of rows) {
      const id = String(row.stripeSubscriptionId || '');
      if (!id.startsWith('sub_') || seen.has(id)) {
        continue;
      }
      seen.add(id);
      subscriptions.push({
        ...mapLedgerToDashboardListItem(row, subscriptions.length),
        plan_notice: await dashboardPlanNotice(row, this.settingsRepository, windows)
      });
    }

    return {
      subscriptions,
      count: subscriptions.length
    };
  }
}

module.exports = {
  SubscriptionsRepository
};
