const { DataSource } = require('typeorm');
const { buildBreedEntitySchema } = require('./entities/breed.entity');
const { buildPriceZonePolicyEntitySchema } = require('./entities/price-zone-policy.entity');
const { CreateBreedsTable1700000000000 } = require('./migrations/1700000000000-create-breeds-table');
const { CreatePriceZonePolicyTable1700000000001 } = require('./migrations/1700000000001-create-price-zone-policy-table');
const { CreateProductsCatalogTables1700000000002 } = require('./migrations/1700000000002-create-products-catalog-tables');

function buildDataSourceOptions(env) {
  return {
    type: 'mysql',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: [
      buildBreedEntitySchema(env.BREEDS_TABLE_NAME),
      buildPriceZonePolicyEntitySchema(env.PRICE_ZONE_POLICY_TABLE_NAME)
    ],
    migrations: [
      CreateBreedsTable1700000000000,
      CreatePriceZonePolicyTable1700000000001,
      CreateProductsCatalogTables1700000000002
    ],
    synchronize: false,
    logging: false,
    charset: 'utf8mb4',
    timezone: 'Z'
  };
}

function createDataSource(env) {
  return new DataSource(buildDataSourceOptions(env));
}

module.exports = {
  buildDataSourceOptions,
  createDataSource
};