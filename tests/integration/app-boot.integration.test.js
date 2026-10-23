const path = require('path');
const { spawn } = require('child_process');
const { DataSource } = require('typeorm');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const connection = {
  type: 'mysql',
  host: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
  port: Number(process.env.INTEGRATION_DB_PORT || 3310),
  username: process.env.INTEGRATION_DB_USER || 'root',
  password: process.env.INTEGRATION_DB_PASSWORD || 'root',
  charset: 'utf8mb4',
  timezone: 'Z',
  entities: [],
  migrations: [],
  synchronize: false,
  logging: false
};

const BOOT_TIMEOUT_MS = 90_000;

async function waitForHttp(url, child, output) {
  const started = Date.now();
  while (Date.now() - started < BOOT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`The API exited with code ${child.exitCode} before answering.\n${output.join('')}`);
    }
    try {
      const response = await fetch(url);
      return response;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`The API did not answer within ${BOOT_TIMEOUT_MS} ms.\n${output.join('')}`);
}

// Boots the API the way production does (`node src/index.js`: migrations, wiring, HTTP server) on an
// empty throwaway database, so an error in the wiring order fails here instead of at deploy time.
describeIntegration('API startup through src/index.js (MySQL)', () => {
  const database = `it_${Date.now()}_boot`;
  const port = 39_000 + Math.floor(Math.random() * 900);
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  const output = [];
  let child;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  });

  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('runs the migrations and answers HTTP without errors', async () => {
    child = spawn(process.execPath, [path.join(__dirname, '../../src/index.js')], {
      cwd: path.join(__dirname, '../..'),
      env: {
        ...process.env,
        DB_HOST: connection.host,
        DB_PORT: String(connection.port),
        DB_USER: connection.username,
        DB_PASSWORD: connection.password,
        DB_NAME: database,
        PORT: String(port),
        MODE: 'http',
        ENABLE_BACKGROUND_JOBS: 'false',
        NODE_ENV: 'test'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));

    const health = await waitForHttp(`http://127.0.0.1:${port}/health`, child, output);
    expect(health.status).toBe(200);

    const products = await fetch(`http://127.0.0.1:${port}/api/v1/products?category_slug=flavors&country=BR`);
    expect(products.status).toBe(200);

    const [{ total }] = await admin.query(
      'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [database, 'pet_life_stage_notices']
    );
    expect(Number(total)).toBe(1);
    expect(child.exitCode).toBeNull();
  }, BOOT_TIMEOUT_MS + 10_000);
});
