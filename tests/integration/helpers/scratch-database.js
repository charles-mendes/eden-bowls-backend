const { DataSource } = require('typeorm');

function connection(database) {
  return new DataSource({
    type: 'mysql',
    host: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
    port: Number(process.env.INTEGRATION_DB_PORT || 3310),
    username: process.env.INTEGRATION_DB_USER || 'root',
    password: process.env.INTEGRATION_DB_PASSWORD || 'root',
    database,
    charset: 'utf8mb4',
    timezone: 'Z',
    entities: [],
    migrations: [],
    synchronize: false,
    logging: false
  });
}

// A throwaway database whose tables copy the dev schema under their real names, so code with
// hard-coded table names (scripts, repositories without table options) runs unchanged.
async function createScratchDatabase(prefix, tables) {
  const source = process.env.INTEGRATION_DB_NAME || 'eden_bowls';
  const database = `it_${prefix}_${Date.now()}`;
  const admin = connection(source);
  await admin.initialize();
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const table of tables) {
    await admin.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``);
  }
  const dataSource = connection(database);
  await dataSource.initialize();

  return {
    database,
    dataSource,
    query: (sql, params) => dataSource.query(sql, params),
    async drop() {
      await dataSource.destroy();
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  };
}

module.exports = {
  createScratchDatabase
};
