const { SubscriptionsDetailRepository } = require('../src/infrastructure/repositories/subscriptions-detail.repository');

describe('SubscriptionsDetailRepository billing history', () => {
  function build(invoices) {
    return new SubscriptionsDetailRepository({
      ledgerRepository: {
        findByUserIdAndSubscriptionId: async () => ({
          stripeSubscriptionId: 'sub_1',
          petsSnapshot: [],
          planSelection: {},
          address: {}
        })
      },
      stripeBilling: {
        listInvoicesForSubscription: async () => invoices
      }
    });
  }

  test('leaves out the R$ 0 invoice Stripe creates when the next charge date moves', async () => {
    const repository = build([
      { id: 'in_move', billing_reason: 'subscription_update', status: 'paid', total: 0, amount_paid: 0, created: 1792724541, currency: 'brl' },
      { id: 'in_create', billing_reason: 'subscription_create', status: 'paid', total: 45247, amount_paid: 45247, created: 1791949280, currency: 'brl' }
    ]);

    const { subscription } = await repository.getDetail(7, 'sub_1');

    expect(subscription.billing_history.map((item) => item.invoice_id)).toEqual(['in_create']);
  });

  test('keeps a charged plan change invoice', async () => {
    const repository = build([
      { id: 'in_change', billing_reason: 'subscription_update', status: 'paid', total: 1200, amount_paid: 1200, created: 1792724541, currency: 'brl' }
    ]);

    const { subscription } = await repository.getDetail(7, 'sub_1');

    expect(subscription.billing_history.map((item) => item.invoice_id)).toEqual(['in_change']);
  });
});
