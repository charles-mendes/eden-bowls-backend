const { AdminUsersService } = require('../src/services/admin-users.service');
const { parseRolesAssignmentInput } = require('../src/api/validators/admin-users-roles.validator');

function buildService(overrides = {}) {
  const users = {
    '1': { id: '1', email: 'admin@edenbowls.com', status: 'active', storedRoles: '["admin"]', profile: {} },
    '2': { id: '2', email: 'ops@edenbowls.com', status: 'active', storedRoles: '["operator"]', profile: {} },
    '3': { id: '3', email: 'client@edenbowls.com', status: 'active', storedRoles: '', profile: {} }
  };

  const usersRepository = {
    findUserById: jest.fn(async (userId) => users[String(userId)] || null),
    listStaff: jest.fn(async () => ({
      total: 2,
      items: [users['1'], users['2']]
    })),
    saveStoredRoles: jest.fn(async (userId, roles) => {
      users[String(userId)].storedRoles = JSON.stringify(roles);
    }),
    ...overrides.usersRepository
  };

  return {
    users,
    usersRepository,
    service: new AdminUsersService({
      usersRepository,
      adminEmails: overrides.adminEmails || 'bootstrap@edenbowls.com'
    })
  };
}

describe('admin users roles', () => {
  test('parses a single role assignment', () => {
    expect(parseRolesAssignmentInput({ role: 'operator' })).toEqual(['operator']);
    expect(parseRolesAssignmentInput({ role: 'customer' })).toEqual([]);
    expect(parseRolesAssignmentInput({ roles: ['nutritionist', 'customer'] })).toEqual(['nutritionist']);
  });

  test('rejects unknown roles', () => {
    expect(() => parseRolesAssignmentInput({ role: 'superadmin' })).toThrow('Invalid role.');
  });

  test('grants operator access', async () => {
    const { service, usersRepository } = buildService();
    const result = await service.updateRoles('3', ['operator'], { userId: '1' });

    expect(usersRepository.saveStoredRoles).toHaveBeenCalledWith('3', ['operator']);
    expect(result.roles).toEqual(['operator']);
    expect(result.storedRoles).toEqual(['operator']);
  });

  test('blocks self lockout', async () => {
    const { service } = buildService();
    await expect(service.updateRoles('1', [], { userId: '1' })).rejects.toMatchObject({
      statusCode: 422,
      message: 'You cannot remove your own panel access.'
    });
  });

  test('blocks removing the last admin', async () => {
    const { service } = buildService({
      adminEmails: '',
      usersRepository: {
        listStaff: jest.fn(async () => ({
          total: 1,
          items: [{ id: '1', email: 'admin@edenbowls.com', storedRoles: '["admin"]' }]
        }))
      }
    });

    await expect(service.updateRoles('1', ['operator'], { userId: '2' })).rejects.toMatchObject({
      statusCode: 422,
      message: 'Cannot remove the last admin.'
    });
  });

  test('keeps allowlisted emails as admin even after storing another role', async () => {
    const { service, users } = buildService({ adminEmails: 'ops@edenbowls.com' });
    users['2'].storedRoles = '';
    const result = await service.updateRoles('2', ['nutritionist'], { userId: '1' });

    expect(result.storedRoles).toEqual(['nutritionist']);
    expect(result.roles).toEqual(['admin', 'nutritionist']);
    expect(result.lockedByAllowlist).toBe(true);
  });
});
