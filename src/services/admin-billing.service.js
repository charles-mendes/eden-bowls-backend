const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');

function dashboardUrl(secretKey, path) {
  const base = String(secretKey || '').startsWith('sk_test_')
    ? 'https://dashboard.stripe.com/test'
    : 'https://dashboard.stripe.com';
  return `${base}${path}`;
}

function presentSubscription(item, secretKey) {
  return {
    id: String(item.id),
    providerSubscriptionId: item.stripeSubscriptionId,
    stripeSubscriptionId: item.stripeSubscriptionId,
    stripeCustomerId: item.stripeCustomerId,
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
    this.stripeBilling = options.stripeBilling || null;
    this.profileRepository = options.profileRepository || null;
    this.secretKey = options.secretKey || '';
  }

  async listSubscriptions(query, pagination) {
    const result = await this.ledgerRepository.listAdmin({
      status: query.status,
      q: query.q,
      offset: pagination.offset,
      perPage: pagination.perPage
    });

    return paginatedEnvelope({
      items: result.items.map((item) => presentSubscription(item, this.secretKey)),
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

    return presentSubscription(item, this.secretKey);
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

    if (!this.stripeBilling || typeof this.stripeBilling.ensureClient !== 'function') {
      return { success: true, data: { scanned: listed.total, updated: 0 } };
    }

    const stripe = this.stripeBilling.ensureClient();
    let updated = 0;

    for (const item of listed.items) {
      try {
        const remote = await stripe.subscriptions.retrieve(item.stripeSubscriptionId);
        await this.ledgerRepository.upsert({
          stripeSubscriptionId: remote.id,
          stripeCustomerId: typeof remote.customer === 'string' ? remote.customer : remote.customer && remote.customer.id,
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

    const stripe = this.stripeBilling.ensureClient();
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
          pdfUrl: `/api/v1/admin/billing/invoices/${invoice.id}/pdf`
        }))
      }
    };
  }

  async invoicePdfUrl(invoiceId) {
    const stripe = this.stripeBilling.ensureClient();
    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (!invoice || !invoice.invoice_pdf) {
      throw new HttpError(404, 'Invoice PDF is not available.');
    }

    return invoice.invoice_pdf;
  }
}

module.exports = {
  AdminBillingService
};
