const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const { buildWebhookHealth, webhookHealthWindows } = require('../core/webhook-health');

class AdminSystemHealthService {
  constructor(options = {}) {
    this.marketConflictsRepository = options.marketConflictsRepository || null;
    this.webhookEventsRepository = options.webhookEventsRepository || null;
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
  }

  async marketConflicts(pagination) {
    if (!this.marketConflictsRepository) {
      throw new HttpError(503, 'Market conflicts are not available.');
    }
    const result = await this.marketConflictsRepository.list({
      offset: pagination.offset,
      perPage: pagination.perPage
    });
    return paginatedEnvelope({
      items: result.items,
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  async webhookHealth() {
    if (!this.webhookEventsRepository) {
      throw new HttpError(503, 'Stripe webhook events are not available.');
    }
    const now = this.now();
    const rows = await this.webhookEventsRepository.healthByAccount(webhookHealthWindows(now));
    return buildWebhookHealth(rows, now);
  }
}

module.exports = {
  AdminSystemHealthService
};
