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

  test('deactivates a customer account', async () => {
    const adminUsersService = {
      updateStatus: jest.fn().mockResolvedValue({
        id: '8',
        email: 'c@d.com',
        status: 'inactive',
        roles: ['customer']
      })
    };
    const identity = {
      userId: '7',
      email: 'ops@edenbowls.com',
      roles: ['operator'],
      permissions: ROLE_PERMISSIONS.operator
    };
    const app = appWithIdentity(identity, { adminUsersService });

    const response = await request(app)
      .patch('/api/v1/admin/users/8/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'inactive' });

    expect(response.status).toBe(200);
    expect(adminUsersService.updateStatus).toHaveBeenCalledWith('8', 'inactive', identity);
    expect(response.body.status).toBe('inactive');
  });

  test('updates a customer delivery address', async () => {
    const adminUsersService = {
      updateDelivery: jest.fn().mockResolvedValue({
        success: true,
        data: { address: 'Rua B', city: 'Curitiba', state: 'PR', zipCode: '80010000', complement: '', deliveryInstructions: '' }
      })
    };
    const app = appWithIdentity({
      userId: '7',
      email: 'ops@edenbowls.com',
      roles: ['operator'],
      permissions: ROLE_PERMISSIONS.operator
    }, { adminUsersService });

    const response = await request(app)
      .patch('/api/v1/admin/users/8/delivery')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ address: 'Rua B', city: 'Curitiba', state: 'PR', zipCode: '80010-000' });

    expect(response.status).toBe(200);
    expect(adminUsersService.updateDelivery).toHaveBeenCalledWith('8', {
      address: 'Rua B',
      city: 'Curitiba',
      state: 'PR',
      zipCode: '80010-000'
    });
  });

  test('forbids readonly from changing account status', async () => {
    const adminUsersService = {
      updateStatus: jest.fn()
    };
    const app = appWithIdentity({
      userId: '7',
      email: 'read@edenbowls.com',
      roles: ['readonly'],
      permissions: ROLE_PERMISSIONS.readonly
    }, { adminUsersService });

    const response = await request(app)
      .patch('/api/v1/admin/users/8/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'inactive' });

    expect(response.status).toBe(403);
    expect(adminUsersService.updateStatus).not.toHaveBeenCalled();
  });
});
