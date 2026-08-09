require('reflect-metadata');

const { parseEnv } = require('./config/env');
const { createLogger } = require('./core/logger');
const { createApp } = require('./app');
const { createDataSource } = require('./infrastructure/db');
const { AuthRepository } = require('./infrastructure/repositories/auth.repository');
const { BreedsRepository } = require('./infrastructure/repositories/breeds.repository');
const { PriceZonePolicyRepository } = require('./infrastructure/repositories/price-zone-policy.repository');
const { ProductsRepository } = require('./infrastructure/repositories/products.repository');
const { AuthService } = require('./services/auth.service');
const { BreedsService } = require('./services/breeds.service');
const { ProductsService } = require('./services/products.service');

async function bootstrap() {
  const env = parseEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });
  const dataSource = createDataSource(env);

  await dataSource.initialize();
  await dataSource.runMigrations();

  const breedsRepository = new BreedsRepository(dataSource, {
    tableName: env.BREEDS_TABLE_NAME
  });
  const authRepository = new AuthRepository(dataSource, {
    usersTableName: env.WP_USERS_TABLE_NAME,
    usermetaTableName: env.WP_USERMETA_TABLE_NAME
  });
  const breedsService = new BreedsService(breedsRepository);
  const authService = new AuthService(authRepository, {
    jwt: {
      secret: env.JWT_AUTH_SECRET_KEY,
      algorithm: env.JWT_AUTH_ALGORITHM,
      issuer: env.JWT_AUTH_ISSUER,
      expiresInSeconds: env.JWT_AUTH_EXPIRES_IN_SECONDS
    }
  });
  const priceZonePolicyRepository = new PriceZonePolicyRepository(dataSource, {
    tableName: env.PRICE_ZONE_POLICY_TABLE_NAME
  });
  const productsRepository = new ProductsRepository(dataSource, {
    postsTableName: env.WP_POSTS_TABLE_NAME,
    postmetaTableName: env.WP_POSTMETA_TABLE_NAME,
    termsTableName: env.WP_TERMS_TABLE_NAME,
    termTaxonomyTableName: env.WP_TERM_TAXONOMY_TABLE_NAME,
    termRelationshipsTableName: env.WP_TERM_RELATIONSHIPS_TABLE_NAME,
    priceZonePolicyRepository
  });
  const productsService = new ProductsService(productsRepository);
  const app = createApp({
    authService,
    breedsService,
    productsService,
    jwt: {
      secret: env.JWT_AUTH_SECRET_KEY,
      algorithm: env.JWT_AUTH_ALGORITHM,
      issuer: env.JWT_AUTH_ISSUER
    },
    corsOrigins: env.CORS_ORIGINS
  });

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, mode: env.MODE }, 'Server started.');
  });
}

if (require.main === module) {
  bootstrap().catch((error) => {
    const logger = createLogger({ nodeEnv: process.env.NODE_ENV });
    logger.error(error, 'Failed to start application.');
    process.exit(1);
  });
}

module.exports = {
  bootstrap
};