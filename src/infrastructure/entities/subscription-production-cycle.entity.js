const { EntitySchema } = require('typeorm');

function buildSubscriptionProductionCycleEntitySchema(tableName = 'subscription_production_cycles') {
  return new EntitySchema({
    name: 'SubscriptionProductionCycle',
    tableName,
    columns: {
      id: {
        type: Number,
        primary: true,
        generated: true,
        unsigned: true
      },
      subscriptionId: {
        name: 'subscription_id',
        type: Number,
        unsigned: true
      },
      periodEnd: {
        name: 'period_end',
        type: 'datetime'
      },
      status: {
        type: String,
        length: 32
      },
      note: {
        type: String,
        length: 255,
        nullable: true
      },
      updatedByUserId: {
        name: 'updated_by_user_id',
        type: 'bigint',
        unsigned: true,
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
    },
    uniques: [
      {
        name: 'uniq_subscription_production_cycle',
        columns: ['subscriptionId', 'periodEnd']
      }
    ]
  });
}

module.exports = {
  buildSubscriptionProductionCycleEntitySchema
};
