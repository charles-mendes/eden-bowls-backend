require('reflect-metadata');

const { parseEnv } = require('../config/env');
const { createDataSource } = require('../infrastructure/db');

async function main() {
  const env = parseEnv();
  const dataSource = createDataSource(env);

  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});