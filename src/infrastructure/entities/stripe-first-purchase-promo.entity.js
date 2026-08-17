const { EntitySchema } = require('typeorm');

function buildStripeFirstPurchasePromoEntitySchema(tableName = 'stripe_first_purchase_promos') {
  return new EntitySchema({
    name: 'StripeFirstPurchasePromo',
    tableName,
    columns: {
      termMonths: {
        name: 'term_months',
        type: 'tinyint',
        unsigned: true,
        primary: true
      },
      promotionCodeId: {
        name: 'promotion_code_id',
        type: String,
        length: 64
      },
      couponId: {
        name: 'coupon_id',
        type: String,
        length: 64,
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

function buildStripeFirstPurchasePromoMetricEntitySchema(tableName = 'stripe_first_purchase_promo_metrics') {
  return new EntitySchema({
    name: 'StripeFirstPurchasePromoMetric',
    tableName,
    columns: {
      metricKey: {
        name: 'metric_key',
        type: String,
        length: 64,
        primary: true
      },
      metricValue: {
        name: 'metric_value',
        type: 'bigint',
        unsigned: true,
        default: 0
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
  buildStripeFirstPurchasePromoEntitySchema,
  buildStripeFirstPurchasePromoMetricEntitySchema
};
