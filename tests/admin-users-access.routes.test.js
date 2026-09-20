const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

function appWithIdentity(identity, extra = {}) {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue(identity)
    },
    ...extra
  });
}

describe('admin users access routes', () => {
  test('creates an access as admin', async () => {
    const adminUsersService = {
      createAccess: jest.fn().mockResolvedValue({
        id: '9',
        email: 'lia@edenbowls.com',
        status: 'pending',
        roles: ['nutritionist'],
        inviteMailStatus: 'sent'
      })
    };
    const identity = {
      userId: '7',
      email: 'admin@edenbowls.com',
      roles: ['admin'],
      permissions: ROLE_PERMISSIONS.admin
    };
    const app = appWithIdentity(identity, { adminUsersService });

    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ name: 'Lia', email: 'lia@edenbowls.com', role: 'nutritionist', market: 'US' });

    expect(response.status).toBe(200);
    expect(adminUsersService.createAccess).toHaveBeenCalledWith({
      name: 'Lia',
      email: 'lia@edenbowls.com',
      phone: '',
      roles: ['nutritionist'],
      markets: ['US']
    }, identity);
    expect(response.body.inviteMailStatus).toBe('sent');
    expect(JSON.stringify(response.body)).not.toMatch(/password/i);
  });

  test('rejects invite without market', async () => {
    const adminUsersService = { createAccess: jest.fn() };
    const app = appWithIdentity({
      userId: '7',
      email: 'admin@edenbowls.com',
      roles: ['admin'],
      permissions: ROLE_PERMISSIONS.admin
    }, { adminUsersService });

    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ name: 'Lia', email: 'lia@edenbowls.com', role: 'operator' });

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: 'market_required' });
    expect(adminUsersService.createAccess).not.toHaveBeenCalled();
  });

  test('forbids operators from creating access', async () => {
    const adminUsersService = { createAccess: jest.fn() };
    const app = appWithIdentity({
      userId: '7',
      email: 'ops@edenbowls.com',
      roles: ['operator'],
      permissions: ROLE_PERMISSIONS.operator
    }, { adminUsersService });

    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ name: 'Lia', email: 'lia@edenbowls.com', role: 'operator' });

    expect(response.status).toBe(403);
    expect(adminUsersService.createAccess).not.toHaveBeenCalled();
  });

  test('resends an invite', async () => {
    const adminUsersService = {
      resendInvite: jest.fn().mockResolvedValue({ id: '8', inviteMailStatus: 'sent' })
    };
    const identity = {
      userId: '7',
      email: 'admin@edenbowls.com',
      roles: ['admin'],
      permissions: ROLE_PERMISSIONS.admin
    };
    const app = appWithIdentity(identity, { adminUsersService });

    const response = await request(app)
      .post('/api/v1/admin/users/8/invite')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(adminUsersService.resendInvite).toHaveBeenCalledWith('8', identity);
  });

  test('soft-deletes an access', async () => {
    const adminUsersService = {
      softDelete: jest.fn().mockResolvedValue({ success: true, id: '8', deletedAt: '2026-01-01 00:00:00' })
    };
    const identity = {
      userId: '7',
      email: 'admin@edenbowls.com',
      roles: ['admin'],
      permissions: ROLE_PERMISSIONS.admin
    };
    const app = appWithIdentity(identity, { adminUsersService });

    const response = await request(app)
      .delete('/api/v1/admin/users/8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(adminUsersService.softDelete).toHaveBeenCalledWith('8', identity);
  });

  test('changes the first-login password', async () => {
    const adminUsersService = {
      completePasswordChange: jest.fn().mockResolvedValue({ success: true, mustChangePassword: false })
    };
    const identity = {
      userId: '7',
      email: 'lia@edenbowls.com',
      roles: ['nutritionist'],
      permissions: ROLE_PERMISSIONS.nutritionist,
      mustChangePassword: true
    };
    const app = appWithIdentity(identity, { adminUsersService });

    const response = await request(app)
      .post('/api/v1/admin/me/password')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ currentPassword: 'temp', newPassword: 'new-password', confirmPassword: 'new-password' });

    expect(response.status).toBe(200);
    expect(adminUsersService.completePasswordChange).toHaveBeenCalled();
    expect(response.body.mustChangePassword).toBe(false);
  });
});
