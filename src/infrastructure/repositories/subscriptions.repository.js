class SubscriptionsRepository {
  async listMine(context = {}) {
    return {
      subscriptions: [
        {
          subscription_id: 'sub_123',
          stripe_subscription_id: 'sub_123',
          legacy_subscription_id: null,
          slug: 'premium-plan',
          plan_label: 'Premium',
          status: 'active',
          stripe_subscription_status: 'active',
          contract_label: 'Premium Plan',
          start_date: '2026-01-01T00:00:00.000Z',
          end_date: null,
          end_date_source: null,
          current_period_start: '2026-08-01T00:00:00.000Z',
          current_period_end: '2026-09-01T00:00:00.000Z',
          next_billing_date: '2026-09-01T00:00:00.000Z',
          next_billing_source: 'stripe',
          next_shipment_date: '2026-08-15T00:00:00.000Z',
          next_shipment_source: 'plan_selection',
          next_shipment_context: { shipping_window: 'weekly' },
          pets_names: ['Milo'],
          pet_ids: ['pet_1'],
          packs_per_month: 2,
          order_total_per_month: 60
        }
      ],
      count: 1
    };
  }
}

module.exports = {
  SubscriptionsRepository
};
