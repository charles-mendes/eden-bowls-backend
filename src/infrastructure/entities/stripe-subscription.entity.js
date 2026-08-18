const { EntitySchema } = require('typeorm');

function buildStripeSubscriptionEntitySchema(tableName = 'stripe_subscriptions') {
  return new EntitySchema({
    name: 'StripeSubscription',
    tableName,
    columns: {
      id: {
        type: Number,
        primary: true,
        generated: true
      },
      userId: {
        name: 'user_id',
        type: 'bigint',
        unsigned: true
      },
      customerEmail: {
        name: 'customer_email',
        type: String,
        length: 255,
        nullable: true
      },
      stripeSubscriptionId: {
        name: 'stripe_subscription_id',
        type: String,
        length: 64,
        unique: true
      },
      stripeCustomerId: {
        name: 'stripe_customer_id',
        type: String,
        length: 64
      },
      status: {
        type: String,
        length: 32
      },
      planLabel: {
        name: 'plan_label',
        type: String,
        length: 128,
        nullable: true
      },
      stripePriceId: {
        name: 'stripe_price_id',
        type: String,
        length: 64,
        nullable: true
      },
      currentPeriodStart: {
        name: 'current_period_start',
        type: 'datetime',
        nullable: true
      },
      currentPeriodEnd: {
        name: 'current_period_end',
        type: 'datetime',
        nullable: true
      },
      cancelAtPeriodEnd: {
        name: 'cancel_at_period_end',
        type: 'tinyint',
        width: 1,
        default: 0
      },
      paymentMethodLast4: {
        name: 'payment_method_last4',
        type: String,
        length: 8,
        nullable: true
      },
      paymentMethodBrand: {
        name: 'payment_method_brand',
        type: String,
        length: 32,
        nullable: true
      },
      petsSnapshot: {
        name: 'pets_snapshot',
        type: 'json',
        nullable: true
      },
      planSelection: {
        name: 'plan_selection',
        type: 'json',
        nullable: true
      },
      shipping: {
        type: 'json',
        nullable: true
      },
      address: {
        type: 'json',
        nullable: true
      },
      subscriptionTermMonths: {
        name: 'subscription_term_months',
        type: 'tinyint',
        unsigned: true,
        nullable: true
      },
      editPaymentPending: {
        name: 'edit_payment_pending',
        type: 'tinyint',
        width: 1,
        default: 0
      },
      editPending: {
        name: 'edit_pending',
        type: 'json',
        nullable: true
      },
      createdAt: {
        name: 'created_at',
        type: 'datetime',
        createDate: true
      },
      updatedAt: {
        name: 'updated_at',
        type: 'datetime',
        updateDate: true
      }
    }
  });
}

module.exports = {
  buildStripeSubscriptionEntitySchema
};
