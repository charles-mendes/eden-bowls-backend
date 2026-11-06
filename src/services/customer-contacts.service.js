const { HttpError } = require('../core/http-error');

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// What the panel shows of a contact. `actor` is who spoke to the customer, for the next operator.
function presentContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    subscription_id: row.subscription_id,
    channel: 'whatsapp',
    reason: row.reason,
    outcome: row.outcome,
    note: row.note,
    actor_email: row.actor_email,
    created_at: toIso(row.created_at)
  };
}

// Contacts an operator makes with a customer outside the system (customer-contacts).
class CustomerContactsService {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.adminBillingService = options.adminBillingService || null;
    this.auditService = options.auditService || null;
    this.now = options.now || (() => new Date());
  }

  ensureReady() {
    if (!this.repository || !this.adminBillingService) {
      throw new HttpError(503, 'Customer contacts are not available.');
    }
  }

  async list(subscriptionId, actor = {}) {
    this.ensureReady();
    // Answers 404 for a subscription of another market.
    const subscription = await this.adminBillingService.getSubscription(subscriptionId, actor);
    const rows = await this.repository.listBySubscription(subscription.id || subscriptionId, 50);
    return { success: true, data: { items: rows.map(presentContact) } };
  }

  async create(subscriptionId, input, actor = {}) {
    this.ensureReady();
    const subscription = await this.adminBillingService.getSubscription(subscriptionId, actor);
    const user = subscription.user || {};
    const row = await this.repository.insert({
      subscriptionId: String(subscription.id || subscriptionId),
      userId: user.id || null,
      stripeAccount: subscription.stripeAccount || null,
      reason: input.reason,
      outcome: input.outcome,
      note: input.note,
      actorId: actor.userId || null,
      actorEmail: actor.email || null,
      createdAt: this.now()
    });
    if (this.auditService && typeof this.auditService.record === 'function') {
      // The note stays out of the audit: it is about the customer and lives only in the contact.
      await this.auditService.record({
        actor,
        action: 'customers.contact.create',
        targetUserId: user.id || null,
        targetEmail: user.email || null,
        metadata: { contactId: row ? row.id : null, subscriptionId: String(subscription.id || subscriptionId), reason: input.reason, outcome: input.outcome }
      });
    }
    return { success: true, data: { contact: presentContact(row) } };
  }
}

module.exports = { CustomerContactsService, presentContact };
