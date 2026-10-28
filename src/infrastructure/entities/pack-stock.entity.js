const { EntitySchema } = require('typeorm');

function buildPackStockItemEntitySchema(tableName = 'pack_stock_items') {
  return new EntitySchema({
    name: 'PackStockItem',
    tableName,
    columns: {
      id: {
        type: 'bigint',
        unsigned: true,
        primary: true,
        generated: true
      },
      market: {
        type: String,
        length: 8
      },
      flavorKey: {
        name: 'flavor_key',
        type: String,
        length: 64
      },
      packSizeGrams: {
        name: 'pack_size_grams',
        type: 'int',
        unsigned: true
      },
      onHand: {
        name: 'on_hand',
        type: 'int',
        default: 0
      },
      minLevel: {
        name: 'min_level',
        type: 'int',
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
        name: 'uniq_pack_stock_item',
        columns: ['market', 'flavorKey', 'packSizeGrams']
      }
    ]
  });
}

function buildPackStockMovementEntitySchema(tableName = 'pack_stock_movements') {
  return new EntitySchema({
    name: 'PackStockMovement',
    tableName,
    columns: {
      id: {
        type: 'bigint',
        unsigned: true,
        primary: true,
        generated: true
      },
      itemId: {
        name: 'item_id',
        type: 'bigint',
        unsigned: true
      },
      type: {
        type: String,
        length: 32
      },
      quantity: {
        type: 'int'
      },
      reason: {
        type: String,
        length: 16,
        nullable: true
      },
      note: {
        type: String,
        length: 255,
        nullable: true
      },
      productionCycleId: {
        name: 'production_cycle_id',
        type: 'int',
        unsigned: true,
        nullable: true
      },
      subscriptionId: {
        name: 'subscription_id',
        type: 'int',
        unsigned: true,
        nullable: true
      },
      actorUserId: {
        name: 'actor_user_id',
        type: 'bigint',
        unsigned: true,
        nullable: true
      },
      createdAt: {
        name: 'created_at',
        type: 'datetime',
        createDate: true
      }
    },
    indices: [
      {
        name: 'idx_pack_stock_movements_item_created',
        columns: ['itemId', 'createdAt']
      },
      {
        name: 'idx_pack_stock_movements_cycle',
        columns: ['productionCycleId']
      }
    ]
  });
}

module.exports = {
  buildPackStockItemEntitySchema,
  buildPackStockMovementEntitySchema
};
