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

describe('admin users roles routes', () => {
  test('lists staff for admin', async () => {
    const adminUsersService = {
      listStaff: jest.fn().mockResolvedValue({
        total: 1,
        page: 1,
        perPage: 50,
        items: [{ id: '8', email: 'ops@edenbowls.com', roles: ['operator'] }],
        bootstrapEmails: ['ops@edenbowls.com']
      })
    };
    const app = appWithIdentity({
      userId: '7',
      email: 'admin@edenbowls.com',
      roles: ['admin'],
      permissions: ROLE_PERMISSIONS.admin
    }, { adminUsersService });

    const response = await request(app)
      .get('/api/v1/admin/users/roles')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.items[0].email).toBe('ops@edenbowls.com');
    expect(response.body.bootstrapEmails).toEqual(['ops@edenbowls.com']);
  });

  test('assigns a role', async () => {
    const adminUsersService = {
      updateRoles: jest.fn().mockResolvedValue({
        id: '8',
        email: 'ops@edenbowls.com',
        storedRoles: ['operator'],
        roles: ['operator'],
        lockedByAllowlist: false
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
      .put('/api/v1/admin/users/8/roles')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ role: 'operator' });

    expect(response.status).toBe(200);
    expect(adminUsersService.updateRoles).toHaveBeenCalledWith('8', ['operator'], identity);
    expect(response.body.roles).toEqual(['operator']);
  });

  test('forbids operator from assigning roles', async () => {
    const adminUsersService = {
      updateRoles: jest.fn()
    };
    const app = appWithIdentity({
      userId: '7',
      email: 'operator@edenbowls.com',
      roles: ['operator'],
      permissions: ROLE_PERMISSIONS.operator
    }, { adminUsersService });

    const response = await request(app)
      .put('/api/v1/admin/users/8/roles')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ role: 'admin' });

    expect(response.status).toBe(403);
    expect(adminUsersService.updateRoles).not.toHaveBeenCalled();
  });
});
