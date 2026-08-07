const { EntitySchema } = require('typeorm');

function buildPriceZonePolicyEntitySchema(tableName = 'price_zone_policy') {
  return new EntitySchema({
    name: 'PriceZonePolicy',
    tableName,
    columns: {
      id: {
        type: Number,
        primary: true,
        generated: true
      },
      countryCode: {
        name: 'country_code',
        type: String,
        length: 2
      },
      currencyCode: {
        name: 'currency_code',
        type: String,
        length: 3
      },
      zoneId: {
        name: 'zone_id',
        type: String,
        length: 64
      },
      isActive: {
        name: 'is_active',
        type: Boolean,
        default: true
      }
    }
  });
}

module.exports = {
  buildPriceZonePolicyEntitySchema
};
