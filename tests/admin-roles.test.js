const { ROLE_PERMISSIONS, parseRoles, permissionsForRoles, resolveAdminRoles } = require('../src/core/admin-roles');

describe('admin roles', () => {
  test('maps nutritionist to simulate only', () => {
    expect(permissionsForRoles(['nutritionist'])).toEqual(['nutrition.simulate']);
  });

  test('gives operator catalog.sync', () => {
    expect(ROLE_PERMISSIONS.operator).toContain('catalog.sync');
    expect(ROLE_PERMISSIONS.operator).toContain('billing.coupons.write');
    expect(ROLE_PERMISSIONS.operator).toContain('users.status.write');
    expect(ROLE_PERMISSIONS.operator).toContain('feedbacks.write');
    expect(ROLE_PERMISSIONS.operator).not.toContain('users.roles.write');
  });

  test('lets readonly list feedbacks but not write them', () => {
    expect(ROLE_PERMISSIONS.readonly).toContain('feedbacks.read');
    expect(ROLE_PERMISSIONS.readonly).not.toContain('feedbacks.write');
  });

  test('reserves role assignment for admin', () => {
    expect(ROLE_PERMISSIONS.admin).toContain('users.roles.write');
  });

  test('bootstraps admin from allowlist email', () => {
    expect(resolveAdminRoles({
      storedRoles: '',
      email: 'ops@edenbowls.com',
      adminEmails: ['ops@edenbowls.com']
    })).toEqual(['admin']);
  });

  test('keeps customer when there is no operational role', () => {
    expect(resolveAdminRoles({ storedRoles: '["customer"]', email: 'user@example.com' })).toEqual(['customer']);
  });

  test('parses usermeta json roles', () => {
    expect(parseRoles('["operator","readonly"]')).toEqual(['operator', 'readonly']);
  });
});
