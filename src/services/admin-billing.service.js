const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const { ledgerStripeAccount, parseStripeAccountInput } = require('../core/stripe-account');
const { resolveStripeBilling } = require('../infrastructure/stripe/stripe-accounts');
const {
  constrainMarketQuery,
  assertStripeAccountMarket,
  canAccessMarket,
  shouldEnforceMarketScope
} = require('../core/admin-market-scope');

function dashboardUrl(secretKey, path) {
  const base = String(secretKey || '').startsWith('sk_test_')
    ? 'https://dashboard.stripe.com/test'
    : 'https://dashboard.stripe.com';
  return `${base}${path}`;
}

function presentSubscription(item, secretKey, actor = {}) {
  const stripeAccount = String(item.stripeAccount || 'us').toLowerCase() || 'us';
  return {
    id: String(item.id),
    providerSubscriptionId: item.stripeSubscriptionId,
    stripeSubscriptionId: item.stripeSubscriptionId,
    stripeCustomerId: item.stripeCustomerId,
    stripeAccount,
    status: item.status,
    autoRenew: !item.cancelAtPeriodEnd,
    nextBillingAt: item.currentPeriodEnd,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    planLabel: item.planLabel,
    stripePriceId: item.stripePriceId,
    currentPeriodStart: item.currentPeriodStart,
    currentPeriodEnd: item.currentPeriodEnd,
    cancelAtPeriodEnd: item.cancelAtPeriodEnd,
    paymentMethodLast4: item.paymentMethodLast4,
    paymentMethodBrand: item.paymentMethodBrand,
    subscriptionTermMonths: item.subscriptionTermMonths,
    petsSnapshot: item.petsSnapshot,
    planSelection: item.planSelection,
    shipping: item.shipping,
    address: item.address,
    customerProfileInScope: canAccessMarket(actor, item.profileMarket),
    user: {
      id: String(item.userId || ''),
      email: item.customerEmail || ''
    },
    term: {
      marketCountry: item.address && item.address.country ? String(item.address.country).toUpperCase() : '',
      months: item.subscriptionTermMonths || 0
    },
    dashboardUrl: dashboardUrl(secretKey, `/subscriptions/${item.stripeSubscriptionId}`)
  };
}

class AdminBillingService {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository;
    this.webhookEventsRepository = options.webhookEventsRepository;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.profileRepository = options.profileRepository || null;
    this.secretKey = options.secretKey || '';
  }

  secretFor(item) {
    const account = ledgerStripeAccount(item);
    try {
      const billing = resolveStripeBilling(this, account);
      return billing.secretKey || this.secretKey || '';
    } catch {
      return this.secretKey || '';
    }
  }

  billingFor(item) {
    return resolveStripeBilling(this, ledgerStripeAccount(item));
  }

  scopedAccounts(query = {}, actor = {}) {
    if (!shouldEnforceMarketScope(actor)) {
      return {
        stripeAccount: query && query.account ? parseStripeAccountInput(query.account) : undefined,
        stripeAccounts: undefined
      };
    }
    const scoped = constrainMarketQuery(actor, query);
    return {
      stripeAccount: scoped.stripeAccount || undefined,
      stripeAccounts: scoped.stripeAccounts
    };
  }

  async listSubscriptions(query, pagination, actor = {}) {
    const { stripeAccount, stripeAccounts } = this.scopedAccounts(query, actor);
    const result = await this.ledgerRepository.listAdmin({
      status: query.status,
      q: query.q,
      stripeAccount,
      stripeAccounts,
      offset: pagination.offset,
      perPage: pagination.perPage
    });

    return paginatedEnvelope({
      items: result.items.map((item) => presentSubscription(item, this.secretFor(item), actor)),
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  async getSubscription(id, actor = {}) {
    const item = await this.ledgerRepository.findById(id);
    if (!item) {
      throw new HttpError(404, 'Subscription not found.');
    }
    if (shouldEnforceMarketScope(actor)) {
      assertStripeAccountMarket(actor, ledgerStripeAccount(item));
    }

    return presentSubscription(item, this.secretFor(item), actor);
  }

  async metrics(actor = {}) {
    const { stripeAccounts } = this.scopedAccounts({}, actor);
    return this.ledgerRepository.metrics({ stripeAccounts });
  }

  async listWebhooks(pagination, type, actor = {}) {
    const { stripeAccounts } = this.scopedAccounts({}, actor);
    const result = await this.webhookEventsRepository.listEvents({
      offset: pagination.offset,
      perPage: pagination.perPage,
      type,
      stripeAccounts
    });

    return paginatedEnvelope({
      items: result.items,
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  async reconcile(actor = {}) {
    const { stripeAccount, stripeAccounts } = this.scopedAccounts({}, actor);
    const listed = await this.ledgerRepository.listAdmin({
      status: 'all',
      stripeAccount,
      stripeAccounts,
      offset: 0,
      perPage: 100
    });

    let updated = 0;
    for (const item of listed.items) {
      try {
        const stripe = this.billingFor(item).ensureClient();
        const remote = await stripe.subscriptions.retrieve(item.stripeSubscriptionId);
        await this.ledgerRepository.upsert({
          stripeSubscriptionId: remote.id,
          stripeCustomerId: typeof remote.customer === 'string' ? remote.customer : remote.customer && remote.customer.id,
          stripeAccount: ledgerStripeAccount(item),
          status: remote.status,
          currentPeriodStart: remote.current_period_start,
          currentPeriodEnd: remote.current_period_end,
          cancelAtPeriodEnd: Boolean(remote.cancel_at_period_end),
          userId: item.userId,
          customerEmail: item.customerEmail
        });
        updated += 1;
      } catch (_error) {
        // keep going; local ledger remains source of truth for the grid
      }
    }

    return { success: true, data: { scanned: listed.items.length, updated } };
  }

  async backfillLinks() {
    const result = await this.ledgerRepository.backfillUserLinks(this.profileRepository);
    return { success: true, data: result };
  }

  async syncInvoices(id, actor = {}) {
    const item = await this.ledgerRepository.findById(id);
    if (!item) {
      throw new HttpError(404, 'Subscription not found.');
    }
    if (shouldEnforceMarketScope(actor)) {
      assertStripeAccountMarket(actor, ledgerStripeAccount(item));
    }

    const stripe = this.billingFor(item).ensureClient();
    const invoices = await stripe.invoices.list({
      subscription: item.stripeSubscriptionId,
      limit: 24
    });

    return {
      success: true,
      data: {
        items: (invoices && Array.isArray(invoices.data) ? invoices.data : []).map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          amountPaid: invoice.amount_paid,
          currency: invoice.currency,
          createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
          pdfUrl: `/api/v1/admin/billing/invoices/${invoice.id}/pdf?account=${ledgerStripeAccount(item)}`
        }))
      }
    };
  }

  async invoicePdfUrl(invoiceId, account, actor = {}) {
    const scoped = shouldEnforceMarketScope(actor) ? constrainMarketQuery(actor, {}) : null;
    const stripeAccount = account
      ? parseStripeAccountInput(account)
      : (scoped && scoped.stripeAccount ? scoped.stripeAccount : null);

    if (!stripeAccount) {
      throw new HttpError(404, 'Invoice PDF is not available.');
    }

    if (shouldEnforceMarketScope(actor)) {
      try {
        assertStripeAccountMarket(actor, stripeAccount);
      } catch (_error) {
        throw new HttpError(404, 'Invoice PDF is not available.');
      }
    }

    try {
      const stripe = resolveStripeBilling(this, stripeAccount).ensureClient();
      const invoice = await stripe.invoices.retrieve(invoiceId);
      if (invoice && invoice.invoice_pdf) {
        return invoice.invoice_pdf;
      }
    } catch (_error) {
      throw new HttpError(404, 'Invoice PDF is not available.');
    }

    throw new HttpError(404, 'Invoice PDF is not available.');
  }
}

module.exports = {
  AdminBillingService
};
