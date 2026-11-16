const { brazilAddressIssues, usAddressIssues } = require('../core/delivery-address-check');
const { shipmentMarket } = require('../core/shipment-market');
const { parseFiscalName, parseTaxDocument } = require('../core/tax-document');

const RECENT_DAYS = 30;
const UNUSABLE = 'courier_address_unusable';
// The order the codes are stored and printed in, so the same set always compares equal.
const CODE_ORDER = [
  'address_street_missing',
  'address_number_missing',
  'address_neighborhood_missing',
  'address_city_missing',
  'address_state_missing',
  'address_zipcode_invalid',
  'address_incomplete',
  'po_box_not_allowed',
  'military_address_not_supported',
  'recipient_name_missing',
  UNUSABLE,
  'tax_document_missing',
  'fiscal_name_missing'
];

function ordered(codes) {
  const rank = (code) => {
    const index = CODE_ORDER.indexOf(code);
    return index === -1 ? CODE_ORDER.length : index;
  };
  return [...new Set(codes)].sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
}

function sameCodes(left, right) {
  const a = ordered(left || []);
  const b = ordered(right || []);
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The `address_issue` of a queue row or a detail: the open problem, or the last one resolved in 30 days, or null.
function presentAddressIssue(issue) {
  if (!issue) return null;
  return {
    id: issue.id,
    codes: issue.codes,
    source: issue.source,
    open: issue.open,
    opened_at: iso(issue.openedAt),
    email_sent_at: iso(issue.emailSentAt),
    resolved_at: iso(issue.resolvedAt),
    resolved_by: issue.resolvedBy
  };
}

function normalized(subscription) {
  if (!subscription) return null;
  const id = Number(subscription.id);
  const userId = Number(subscription.userId || (subscription.user && subscription.user.id));
  if (!Number.isInteger(id) || id <= 0 || !userId || !subscription.stripeSubscriptionId) return null;
  return { ...subscription, id, userId };
}

// Address problems (delivery-address-issues): opened by an event, never by a read; one open per subscription; one
// email per problem; closed when the customer saves data that passes. Every method only logs its errors, because a
// problem is a side effect of a dispatch, a label, a payment or a note, never a condition for it.
class DeliveryAddressIssueService {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.fiscalRepository = options.fiscalRepository || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.mailer = options.mailer || null;
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
    this.now = options.now || (() => new Date());
  }

  // Everything still wrong for this subscription, or null for a market exception, which never opens a problem.
  async codesFor(subscription, extra = []) {
    const address = subscription && subscription.address;
    const { market } = shipmentMarket({ stripeAccount: subscription && subscription.stripeAccount, address });
    if (!market) return null;
    const codes = market === 'BR' ? brazilAddressIssues(address) : usAddressIssues(address);
    if (market === 'BR') {
      const fiscal = this.fiscalRepository ? await this.fiscalRepository.findFiscalData(subscription.userId) : {};
      if (!parseTaxDocument(fiscal && fiscal.taxDocument)) codes.push('tax_document_missing');
      if (!parseFiscalName(fiscal && fiscal.fiscalName)) codes.push('fiscal_name_missing');
    }
    return ordered([...codes, ...extra]);
  }

  // `subscription` is the ledger row or the admin subscription (string ids, `user.id`). `extra` carries what only
  // the event knows (`courier_address_unusable`).
  async report({ subscription: input, source, extra = [] } = {}) {
    const subscription = normalized(input);
    if (!this.repository || !subscription) return null;
    try {
      const open = await this.repository.findOpen(subscription.id);
      // The courier's refusal of the address stays until the customer saves a new one.
      const kept = open && open.codes.includes(UNUSABLE) ? [UNUSABLE] : [];
      const codes = await this.codesFor(subscription, [...extra, ...kept]);
      if (!codes || codes.length === 0) return null;
      if (open && sameCodes(open.codes, codes)) return open;
      if (open) {
        await this.repository.close(open.id, { resolvedBy: 'superseded', now: this.now() });
      }
      const { inserted, issue } = await this.repository.insertOpen({
        subscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        userId: subscription.userId,
        stripeAccount: String(subscription.stripeAccount || '').toLowerCase(),
        codes,
        source,
        now: this.now()
      });
      if (inserted) await this.sendEmail(issue, subscription);
      return issue;
    } catch (error) {
      this.logger.error({ subscriptionId: subscription.stripeSubscriptionId, source, message: error && error.message }, 'Address problem not recorded.');
      return null;
    }
  }

  async sendEmail(issue, subscription) {
    if (!this.mailer || typeof this.mailer.notifyDeliveryAddressIssue !== 'function') return;
    try {
      const result = await this.mailer.notifyDeliveryAddressIssue({ issue, subscription });
      if (result && result.claimed && !result.skipped) {
        await this.repository.markEmailSent(issue.id, this.now());
      }
    } catch (error) {
      this.logger.error({ issueId: issue.id, message: error && error.message }, 'Address problem email not sent.');
    }
  }

  // After the customer saved (subscription-contract): the CPF and the fiscal name are the account's, so every open
  // problem of the user is checked again. What is left stays on the same problem, without an email; saving is not
  // an opening event. `addressSavedFor` lists the Stripe subscription ids whose address was saved.
  async recheckForUser(userId, { addressSavedFor = [] } = {}) {
    if (!this.repository || !this.ledgerRepository) return { closed: 0, updated: 0 };
    let closed = 0;
    let updated = 0;
    try {
      for (const issue of await this.repository.listOpenByUser(userId)) {
        const subscription = await this.ledgerRepository.findByStripeSubscriptionId(issue.stripeSubscriptionId);
        const keepUnusable = issue.codes.includes(UNUSABLE) && !addressSavedFor.includes(issue.stripeSubscriptionId);
        const codes = subscription ? await this.codesFor(subscription, keepUnusable ? [UNUSABLE] : []) : null;
        if (!codes || codes.length === 0) {
          if (await this.repository.close(issue.id, { resolvedBy: 'customer', now: this.now() })) closed += 1;
        } else if (!sameCodes(issue.codes, codes)) {
          await this.repository.updateCodes(issue.id, codes);
          updated += 1;
        }
      }
    } catch (error) {
      this.logger.error({ userId, message: error && error.message }, 'Address problems not checked again.');
    }
    return { closed, updated };
  }

  // After an operator filled data of one subscription in the panel (operator-fills-recipient-name): its open
  // problem is checked again like a customer save, closing with `resolvedBy` when nothing is left. No email.
  async recheckSubscription(input, { resolvedBy = 'operator' } = {}) {
    const subscription = normalized(input);
    if (!this.repository || !subscription) return null;
    try {
      const open = await this.repository.findOpen(subscription.id);
      if (!open) return null;
      const codes = await this.codesFor(subscription, open.codes.includes(UNUSABLE) ? [UNUSABLE] : []);
      if (!codes || codes.length === 0) {
        const closed = await this.repository.close(open.id, { resolvedBy, now: this.now() });
        return { closed: Boolean(closed), codes: [] };
      }
      if (!sameCodes(open.codes, codes)) await this.repository.updateCodes(open.id, codes);
      return { closed: false, codes };
    } catch (error) {
      this.logger.error({ subscriptionId: subscription.stripeSubscriptionId, message: error && error.message }, 'Address problem not checked again.');
      return null;
    }
  }

  // close-address-issues-when-subscription-ends: after the subscription changed in Stripe or a box left, closes its
  // open problem as `ended` when it is canceled with no paid box left to ship. No email; errors are only logged.
  async closeIfEnded(subscriptionId) {
    if (!this.repository || typeof this.repository.closeEnded !== 'function' || subscriptionId == null) return 0;
    try {
      return await this.repository.closeEnded({ subscriptionId, now: this.now() });
    } catch (error) {
      this.logger.error({ subscriptionId, message: error && error.message }, 'Address problem of an ended subscription not closed.');
      return 0;
    }
  }

  // Ledger id → `address_issue` for a page of rows, in one query. A read never opens a problem.
  async latestForSubscriptions(subscriptionIds = []) {
    if (!this.repository || subscriptionIds.length === 0) return new Map();
    try {
      const since = new Date(this.now().getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
      const latest = await this.repository.latestForSubscriptions(subscriptionIds, { since });
      return new Map([...latest].map(([id, issue]) => [id, presentAddressIssue(issue)]));
    } catch (error) {
      this.logger.error({ message: error && error.message }, 'Address problems not read.');
      return new Map();
    }
  }

  async latestFor(subscriptionId) {
    const latest = await this.latestForSubscriptions([subscriptionId]);
    return latest.get(Number(subscriptionId)) || null;
  }
}

module.exports = { DeliveryAddressIssueService, presentAddressIssue, CODE_ORDER };
