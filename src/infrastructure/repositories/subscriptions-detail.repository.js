class SubscriptionsDetailRepository {
  async getDetail(subscriptionId, context = {}) {
    return {
      subscription: {
        subscription_id: subscriptionId,
        stripe_subscription_id: subscriptionId,
        legacy_subscription_id: null,
        slug: 'premium-plan',
        plan_label: 'Premium',
        status: 'active',
        stripe_subscription_status: 'active',
        contract_label: 'Premium plan',
        start_date: '2026-01-01T00:00:00.000Z',
        end_date: null,
        end_date_source: null,
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        next_billing_date: '2026-09-01T00:00:00.000Z',
        next_billing_source: 'stripe',
        next_shipment_date: '2026-08-15T00:00:00.000Z',
        next_shipment_source: 'plan_selection',
        next_shipment_context: {
          shipping_window: 'weekly'
        },
        pets_names: ['Milo'],
        pet_ids: ['pet_1'],
        pets: [{ id: 'pet_1', name: 'Milo' }],
        packs_per_month: 2,
        order_total_per_month: 60,
        packs_per_delivery: 2,
        frequency: 'monthly',
        active_flavors: ['chicken'],
        price_per_cycle: 30,
        cycle_unit: 'month',
        payment_method_brand: 'visa',
        payment_method_last4: '4242',
        delivery_address: 'Rua Teste, 123',
        auto_renew: true,
        current_cycle: 1,
        total_cycles: 3,
        billing_history: [],
        plan_items: [],
        plan_items_source: 'plan_selection',
        stripe_timeline: [],
        edit_payment_pending: false,
        subscription_term_months: 1
      }
    };
  }
}

module.exports = {
  SubscriptionsDetailRepository
};
