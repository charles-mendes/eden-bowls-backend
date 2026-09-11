const { EntitySchema } = require('typeorm');

function buildShippingBrSettingsEntitySchema(tableName = 'shipping_br_settings') {
  return new EntitySchema({
    name: 'ShippingBrSettings',
    tableName,
    columns: {
      id: {
        type: Number,
        primary: true
      },
      enabled: {
        type: Boolean,
        default: true
      },
      label: {
        type: String,
        length: 191
      },
      centerName: {
        name: 'center_name',
        type: String,
        length: 191
      },
      centerStreet: {
        name: 'center_street',
        type: String,
        length: 191,
        default: ''
      },
      centerCity: {
        name: 'center_city',
        type: String,
        length: 128,
        default: ''
      },
      centerState: {
        name: 'center_state',
        type: String,
        length: 8,
        default: ''
      },
      centerZipcode: {
        name: 'center_zipcode',
        type: String,
        length: 16,
        default: ''
      },
      centerLat: {
        name: 'center_lat',
        type: 'decimal',
        precision: 10,
        scale: 6
      },
      centerLng: {
        name: 'center_lng',
        type: 'decimal',
        precision: 10,
        scale: 6
      },
      centerVersion: {
        name: 'center_version',
        type: String,
        length: 32,
        default: '1'
      },
      perKm: {
        name: 'per_km',
        type: 'decimal',
        precision: 10,
        scale: 4
      },
      roadFactor: {
        name: 'road_factor',
        type: 'decimal',
        precision: 8,
        scale: 4
      },
      minFee: {
        name: 'min_fee',
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
      },
      maxFee: {
        name: 'max_fee',
        type: 'decimal',
        precision: 10,
        scale: 2,
        nullable: true
      },
      maxDistanceKm: {
        name: 'max_distance_km',
        type: 'decimal',
        precision: 10,
        scale: 2
      },
      kmPerDay: {
        name: 'km_per_day',
        type: 'decimal',
        precision: 10,
        scale: 2
      },
      minDays: {
        name: 'min_days',
        type: Number
      },
      maxDays: {
        name: 'max_days',
        type: Number
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

function buildShippingUsSettingsEntitySchema(tableName = 'shipping_us_settings') {
  return new EntitySchema({
    name: 'ShippingUsSettings',
    tableName,
    columns: {
      id: {
        type: Number,
        primary: true
      },
      enabled: {
        type: Boolean,
        default: true
      },
      cost: {
        type: 'decimal',
        precision: 10,
        scale: 2
      },
      label: {
        type: String,
        length: 191
      },
      carrier: {
        type: String,
        length: 128
      },
      delivery: {
        type: String,
        length: 191
      },
      quoteMode: {
        name: 'quote_mode',
        type: String,
        length: 16,
        default: 'fixed'
      },
      fallbackEnabled: {
        name: 'fallback_enabled',
        type: Boolean,
        default: true
      },
      shipFromName: {
        name: 'ship_from_name',
        type: String,
        length: 191,
        default: ''
      },
      shipFromStreet: {
        name: 'ship_from_street',
        type: String,
        length: 191,
        default: ''
      },
      shipFromCity: {
        name: 'ship_from_city',
        type: String,
        length: 128,
        default: ''
      },
      shipFromState: {
        name: 'ship_from_state',
        type: String,
        length: 8,
        default: ''
      },
      shipFromZipcode: {
        name: 'ship_from_zipcode',
        type: String,
        length: 16,
        default: ''
      },
      shipFromCountry: {
        name: 'ship_from_country',
        type: String,
        length: 2,
        default: 'US'
      },
      packageWeightLb: {
        name: 'package_weight_lb',
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 10
      },
      packageLengthIn: {
        name: 'package_length_in',
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 12
      },
      packageWidthIn: {
        name: 'package_width_in',
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 12
      },
      packageHeightIn: {
        name: 'package_height_in',
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 12
      },
      allowedServiceCodes: {
        name: 'allowed_service_codes',
        type: 'text',
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
  buildShippingBrSettingsEntitySchema,
  buildShippingUsSettingsEntitySchema
};
