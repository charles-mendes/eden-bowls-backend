const { EntitySchema } = require('typeorm');

function buildDeliveryClosedDayEntitySchema(tableName = 'delivery_closed_days') {
  return new EntitySchema({
    name: 'DeliveryClosedDay',
    tableName,
    columns: {
      id: { type: Number, primary: true, generated: true, unsigned: true },
      market: { type: String, length: 8 },
      closedOn: { name: 'closed_on', type: 'date' },
      label: { type: String, length: 191 },
      origin: { type: String, length: 16 },
      active: { type: Boolean, default: true },
      closesPreparation: { name: 'closes_preparation', type: Boolean, default: false },
      closesPickup: { name: 'closes_pickup', type: Boolean, default: false },
      closesDelivery: { name: 'closes_delivery', type: Boolean, default: false },
      createdAt: { name: 'created_at', type: 'datetime', createDate: true },
      updatedAt: { name: 'updated_at', type: 'datetime', updateDate: true }
    }
  });
}

module.exports = {
  buildDeliveryClosedDayEntitySchema
};
