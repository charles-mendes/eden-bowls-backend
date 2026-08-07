require('reflect-metadata');

const { parseEnv } = require('./config/env');
const { createLogger } = require('./core/logger');
const { createApp } = require('./app');
const { createDataSource } = require('./infrastructure/db');
const { BreedsRepository } = require('./infrastructure/repositories/breeds.repository');
const { BreedsService } = require('./services/breeds.service');

async function bootstrap() {
  const env = parseEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });
  const dataSource = createDataSource(env);

  await dataSource.initialize();

  const breedsRepository = new BreedsRepository(dataSource, {
    tableName: env.BREEDS_TABLE_NAME
  });
  const breedsService = new BreedsService(breedsRepository);
  const app = createApp({ breedsService });

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