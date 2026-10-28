const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { LegalDocumentsService } = require('../src/services/legal-documents.service');
const { LEGAL_DOCUMENT_SEED } = require('../src/infrastructure/migrations/helpers/seed-legal-documents');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

const IDENTITIES = {
  admin: { userId: '1', email: 'admin@edenbowls.com', roles: ['admin'], permissions: ROLE_PERMISSIONS.admin },
  operator: { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR', 'US'] }
};

// An in-memory legal_documents: rows are only inserted, the current one is the last published.
function memoryRepository() {
  let clock = Date.parse('2026-09-13T00:00:00Z');
  const rows = LEGAL_DOCUMENT_SEED.map((document) => ({
    market: document.market, kind: document.kind, version: '2026-09-13', body: document.body, publishedAt: new Date(clock).toISOString(), publishedBy: null
  }));
  const of = (market, kind) => rows.filter((row) => row.market === market && row.kind === kind);
  return {
    rows,
    current: jest.fn(async (market, kind) => of(market, kind).slice(-1)[0] || null),
    versions: jest.fn(async (market, kind) => of(market, kind).slice().reverse().map(({ body, ...row }) => row)),
    findVersion: jest.fn(async (market, kind, version) => of(market, kind).find((row) => row.version === version) || null),
    publish: jest.fn(async ({ market, kind, version, body, actorId }) => {
      if (of(market, kind).some((row) => row.version === version)) {
        const { HttpError } = require('../src/core/http-error');
        throw new HttpError(409, 'This version id is already published.', { code: 'legal_version_taken' });
      }
      clock += 1000;
      rows.push({ market, kind, version, body, publishedAt: new Date(clock).toISOString(), publishedBy: actorId });
    })
  };
}

function setup(identity) {
  const repository = memoryRepository();
  const auditRepository = { createIn: jest.fn() };
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    legalDocumentsService: new LegalDocumentsService({ repository, auditRepository, dataSource: { transaction: async (work) => work({ tx: true }) } })
  });
  return { app, repository, auditRepository };
}

const auth = (call) => call.set('Authorization', `Bearer ${tokenFor()}`);

describe('legal documents routes', () => {
  test('Store reads the BR privacy policy', async () => {
    const { app } = setup(IDENTITIES.admin);

    const response = await request(app).get('/api/v1/legal/privacy?market=br');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ market: 'BR', kind: 'privacy', version: '2026-09-13', published_at: '2026-09-13T00:00:00.000Z' });
    expect(response.body.body_markdown).toContain('Esta Política de Privacidade entra em vigor');
  });

  test('an unknown kind answers 404 and an unknown market 400 invalid_market', async () => {
    const { app } = setup(IDENTITIES.admin);
    expect((await request(app).get('/api/v1/legal/cookies?market=BR')).status).toBe(404);
    const market = await request(app).get('/api/v1/legal/terms?market=MX');
    expect(market.status).toBe(400);
    expect(market.body.details).toEqual({ code: 'invalid_market' });
  });

  test('Publish new terms in US', async () => {
    const { app, auditRepository } = setup(IDENTITIES.admin);

    const response = await auth(request(app).post('/api/v1/admin/legal/terms'))
      .send({ market: 'US', version: '2026-11-01', body_markdown: '## Terms\n\nNew text.' });

    expect(response.status).toBe(200);
    expect(response.body.current).toMatchObject({ version: '2026-11-01', body_markdown: '## Terms\n\nNew text.' });
    expect(response.body.versions.map((item) => item.version)).toEqual(['2026-11-01', '2026-09-13']);
    expect((await request(app).get('/api/v1/legal/terms?market=US')).body.version).toBe('2026-11-01');
    expect((await auth(request(app).get('/api/v1/admin/legal/terms/versions/2026-09-13?market=US'))).body.body_markdown).toContain('Terms');
    expect((await request(app).get('/api/v1/legal/terms?market=BR')).body.version).toBe('2026-09-13');
    expect(auditRepository.createIn).toHaveBeenCalledWith({ tx: true }, expect.objectContaining({
      action: 'legal.document.publish',
      metadata: { market: 'US', kind: 'terms', version: '2026-11-01' }
    }));
  });

  test('Version id already used', async () => {
    const { app } = setup(IDENTITIES.admin);

    const response = await auth(request(app).post('/api/v1/admin/legal/privacy'))
      .send({ market: 'BR', version: '2026-09-13', body_markdown: 'Outro texto.' });

    expect(response.status).toBe(409);
    expect(response.body.details).toEqual({ code: 'legal_version_taken' });
  });

  test('refuses an invalid version id or an empty body, and only the admin publishes', async () => {
    const { app } = setup(IDENTITIES.admin);
    const invalid = await auth(request(app).post('/api/v1/admin/legal/privacy')).send({ market: 'BR', version: '2026-02-30', body_markdown: ' ' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.details).toEqual({ code: 'legal_document_invalid', fields: ['version', 'body_markdown'] });

    const operator = setup(IDENTITIES.operator);
    expect((await auth(request(operator.app).get('/api/v1/admin/legal/privacy?market=BR'))).status).toBe(200);
    expect((await auth(request(operator.app).post('/api/v1/admin/legal/privacy')).send({ market: 'BR', version: '2026-11-01', body_markdown: 'x' })).status).toBe(403);
  });
});
