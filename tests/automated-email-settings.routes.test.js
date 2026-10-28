const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AutomatedEmailSettingsService } = require('../src/services/automated-email-settings.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

const IDENTITIES = {
  operator: { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR', 'US'] },
  readonly: { userId: '9', email: 'ro@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['BR', 'US'] }
};

function setup(identity) {
  const stored = { BR: { lifeStageChangeEnabled: true, announcementBatchSize: 50, announcementDailyCap: 300, updatedAt: null } };
  const repository = {
    forMarket: jest.fn(async (market) => ({ ...stored[market] })),
    save: jest.fn(async (market, settings) => { stored[market] = { ...settings, updatedAt: '2026-10-27T12:00:00.000Z' }; })
  };
  const auditRepository = { createIn: jest.fn() };
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    automatedEmailSettingsService: new AutomatedEmailSettingsService({ repository, auditRepository, dataSource: { transaction: async (work) => work({ tx: true }) } })
  });
  return { app, repository, auditRepository, stored };
}

const auth = (call) => call.set('Authorization', `Bearer ${tokenFor()}`);
const body = (changes = {}) => ({ market: 'BR', life_stage_change_enabled: true, announcement_batch_size: 50, announcement_daily_cap: 300, ...changes });

describe('admin automated email settings routes', () => {
  test('Cap lower than batch', async () => {
    const { app, repository, stored } = setup(IDENTITIES.operator);

    const response = await auth(request(app).put('/api/v1/admin/settings/automated-emails')).send(body({ announcement_batch_size: 100, announcement_daily_cap: 50 }));

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual({ code: 'automated_email_settings_invalid', fields: ['announcement_daily_cap'] });
    expect(repository.save).not.toHaveBeenCalled();
    expect(stored.BR).toMatchObject({ announcementBatchSize: 50, announcementDailyCap: 300 });
  });

  test('refuses values outside the limits and a switch that is not a boolean', async () => {
    const { app } = setup(IDENTITIES.operator);
    const response = await auth(request(app).put('/api/v1/admin/settings/automated-emails'))
      .send(body({ life_stage_change_enabled: 'no', announcement_batch_size: 501, announcement_daily_cap: 5001 }));
    expect(response.status).toBe(422);
    expect(response.body.details.fields).toEqual(['life_stage_change_enabled', 'announcement_batch_size', 'announcement_daily_cap']);
  });

  test('the operator pauses BR, recorded as settings.email.update', async () => {
    const { app, auditRepository } = setup(IDENTITIES.operator);

    const response = await auth(request(app).put('/api/v1/admin/settings/automated-emails')).send(body({ life_stage_change_enabled: false }));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ market: 'BR', life_stage_change_enabled: false, announcement_batch_size: 50 });
    expect(auditRepository.createIn).toHaveBeenCalledWith({ tx: true }, expect.objectContaining({
      action: 'settings.email.update',
      metadata: {
        market: 'BR',
        before: { lifeStageChangeEnabled: true, announcementBatchSize: 50, announcementDailyCap: 300 },
        after: { lifeStageChangeEnabled: false, announcementBatchSize: 50, announcementDailyCap: 300 }
      }
    }));
  });

  test('readonly reads but cannot save', async () => {
    const { app } = setup(IDENTITIES.readonly);
    expect((await auth(request(app).get('/api/v1/admin/settings/automated-emails?market=BR'))).body).toMatchObject({ life_stage_change_enabled: true });
    expect((await auth(request(app).put('/api/v1/admin/settings/automated-emails')).send(body())).status).toBe(403);
  });
});
