const { DataSource } = require('typeorm');
const { CreateLegalDocuments1700000000052 } = require('../../src/infrastructure/migrations/1700000000052-create-legal-documents');
const { LEGAL_DOCUMENT_SEED } = require('../../src/infrastructure/migrations/helpers/seed-legal-documents');
const { LegalDocumentsRepository } = require('../../src/infrastructure/repositories/legal-documents.repository');

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

describeIntegration('legal documents (MySQL)', () => {
  const database = `it_${Date.now()}_legal`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateLegalDocuments1700000000052().up(runner);
    await new CreateLegalDocuments1700000000052().up(runner);
    await runner.release();
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('the migration run twice stores the four texts once, byte for byte', async () => {
    const rows = await dataSource.query('SELECT market, kind, version, body_markdown FROM legal_documents ORDER BY id');
    expect(rows.map((row) => `${row.market} ${row.kind} ${row.version}`)).toEqual([
      'BR privacy 2026-09-13', 'BR terms 2026-09-13', 'US privacy 2026-09-13', 'US terms 2026-09-13'
    ]);
    rows.forEach((row, index) => expect(row.body_markdown).toBe(LEGAL_DOCUMENT_SEED[index].body));
  });

  test('a new version becomes current, the old stays readable, and a used id answers 409', async () => {
    const repository = new LegalDocumentsRepository(dataSource);
    expect((await repository.current('US', 'terms')).version).toBe('2026-09-13');

    await repository.publish({ market: 'US', kind: 'terms', version: '2026-11-01', body: '## Terms\n\nNew.', actorId: 1 });

    expect(await repository.current('US', 'terms')).toMatchObject({ version: '2026-11-01', body: '## Terms\n\nNew.', publishedBy: 1 });
    expect((await repository.findVersion('US', 'terms', '2026-09-13')).body).toBe(LEGAL_DOCUMENT_SEED[3].body);
    expect((await repository.current('BR', 'terms')).version).toBe('2026-09-13');
    await expect(repository.publish({ market: 'BR', kind: 'privacy', version: '2026-09-13', body: 'x' }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'legal_version_taken' } });
  });
});
