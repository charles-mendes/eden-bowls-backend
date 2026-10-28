const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { COMPANY_PROFILE_SEED, companyProfilePayload } = require('../src/core/company-profile');
const { CompanyProfileService } = require('../src/services/company-profile.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

const IDENTITIES = {
  admin: { userId: '1', email: 'admin@edenbowls.com', roles: ['admin'], permissions: ROLE_PERMISSIONS.admin },
  operator: { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR', 'US'] },
  veterinarian: { userId: '5', email: 'vet@edenbowls.com', roles: ['veterinarian'], permissions: ROLE_PERMISSIONS.veterinarian }
};

function setup(identity) {
  const repository = {
    forMarket: jest.fn(async (market) => ({ ...COMPANY_PROFILE_SEED[market], updatedAt: null })),
    save: jest.fn()
  };
  const auditRepository = { createIn: jest.fn() };
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    companyProfileService: new CompanyProfileService({ repository, auditRepository, dataSource: { transaction: async (work) => work({ tx: true }) } })
  });
  return { app, repository, auditRepository };
}

const auth = (call) => call.set('Authorization', `Bearer ${tokenFor()}`);
const brProfile = (changes = {}) => {
  const { market, ...fields } = companyProfilePayload('BR', COMPANY_PROFILE_SEED.BR);
  return { ...fields, ...changes };
};

describe('admin company settings routes', () => {
  test('Operator reads but cannot save', async () => {
    const { app, repository } = setup(IDENTITIES.operator);

    const read = await auth(request(app).get('/api/v1/admin/settings/company?market=BR'));
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ market: 'BR', legal_name: 'C. C. J. Lovato Ltda', tax_id: '65.291.985/0001-05', city: 'Curitiba' });

    const save = await auth(request(app).put('/api/v1/admin/settings/company')).send({ market: 'BR', profile: brProfile() });
    expect(save.status).toBe(403);
    expect(repository.save).not.toHaveBeenCalled();
  });

  test('the veterinarian does not read the company settings', async () => {
    const { app } = setup(IDENTITIES.veterinarian);
    expect((await auth(request(app).get('/api/v1/admin/settings/company?market=BR'))).status).toBe(403);
  });

  test('Invalid CNPJ', async () => {
    const { app, repository } = setup(IDENTITIES.admin);

    const response = await auth(request(app).put('/api/v1/admin/settings/company'))
      .send({ market: 'BR', profile: brProfile({ tax_id: '11.111.111/1111-11' }) });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual({ code: 'company_profile_invalid', fields: ['tax_id'] });
    expect(repository.save).not.toHaveBeenCalled();
  });

  test('the admin saves the BR city, recorded as settings.company.update with the changed fields', async () => {
    const { app, repository, auditRepository } = setup(IDENTITIES.admin);

    const response = await auth(request(app).put('/api/v1/admin/settings/company'))
      .send({ market: 'BR', profile: brProfile({ city: 'São Paulo', state: 'SP', tax_id: '65291985000105' }) });

    expect(response.status).toBe(200);
    expect(repository.save).toHaveBeenCalledWith('BR', expect.objectContaining({ city: 'São Paulo', state: 'SP', taxId: '65.291.985/0001-05' }), 1, { tx: true });
    expect(auditRepository.createIn).toHaveBeenCalledWith({ tx: true }, expect.objectContaining({
      action: 'settings.company.update',
      metadata: { market: 'BR', fields: ['city', 'state'] }
    }));
  });

  test('the US profile accepts an empty tax id and refuses a store URL without https', async () => {
    const { app } = setup(IDENTITIES.admin);
    const { market, ...us } = companyProfilePayload('US', COMPANY_PROFILE_SEED.US);
    expect((await auth(request(app).put('/api/v1/admin/settings/company')).send({ market: 'US', profile: us })).status).toBe(200);
    const insecure = await auth(request(app).put('/api/v1/admin/settings/company'))
      .send({ market: 'US', profile: { ...us, store_url: 'http://edenbowls.com', legal_name: '' } });
    expect(insecure.status).toBe(422);
    expect(insecure.body.details.fields).toEqual(['legal_name', 'store_url']);
  });
});
