const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const { ledgerStripeAccount, parseStripeAccountInput } = require('../core/stripe-account');
const { resolveStripeBilling } = require('../infrastructure/stripe/stripe-accounts');

function dashboardUrl(secretKey, path) {
  const base = String(secretKey || '').startsWith('sk_test_')
    ? 'https://dashboard.stripe.com/test'
    : 'https://dashboard.stripe.com';
  return `${base}${path}`;
}

function presentSubscription(item, secretKey) {
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

  async listSubscriptions(query, pagination) {
    let stripeAccount;
    if (query && query.account) {
      stripeAccount = parseStripeAccountInput(query.account);
    }
    const result = await this.ledgerRepository.listAdmin({
      status: query.status,
      q: query.q,
      stripeAccount,
      offset: pagination.offset,
      perPage: pagination.perPage
    });

    return paginatedEnvelope({
      items: result.items.map((item) => presentSubscription(item, this.secretFor(item))),
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  async getSubscription(id) {
    const item = await this.ledgerRepository.findById(id);
    if (!item) {
      throw new HttpError(404, 'Subscription not found.');
    }

    return presentSubscription(item, this.secretFor(item));
  }

  async metrics() {
    return this.ledgerRepository.metrics();
  }

  async listWebhooks(pagination, type) {
    const result = await this.webhookEventsRepository.listEvents({
      offset: pagination.offset,
      perPage: pagination.perPage,
      type
    });

    return paginatedEnvelope({
      items: result.items,
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  async reconcile() {
    const listed = await this.ledgerRepository.listAdmin({
      status: 'all',
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

  async syncInvoices(id) {
    const item = await this.ledgerRepository.findById(id);
    if (!item) {
      throw new HttpError(404, 'Subscription not found.');
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

  async invoicePdfUrl(invoiceId, account) {
    const accounts = account
      ? [parseStripeAccountInput(account)]
      : ['us', 'br'];

    for (const stripeAccount of accounts) {
      try {
        const stripe = resolveStripeBilling(this, stripeAccount).ensureClient();
        const invoice = await stripe.invoices.retrieve(invoiceId);
        if (invoice && invoice.invoice_pdf) {
          return invoice.invoice_pdf;
        }
      } catch (_error) {
        // try the other account
      }
    }

    throw new HttpError(404, 'Invoice PDF is not available.');
  }
}

module.exports = {
  AdminBillingService
};
