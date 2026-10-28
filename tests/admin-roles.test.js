const { ROLE_PERMISSIONS, parseRoles, permissionsForRoles, resolveAdminRoles } = require('../src/core/admin-roles');

describe('admin roles', () => {
  test('maps veterinarian to simulate and nutrition settings only', () => {
    expect(permissionsForRoles(['veterinarian'])).toEqual(['nutrition.simulate', 'nutrition.settings.write']);
  });

  test('gives each role exactly the new settings permissions of phase 3', () => {
    const NEW = ['nutrition.settings.write', 'settings.read', 'settings.company.write', 'settings.email.write', 'legal.write'];
    const granted = (role) => NEW.filter((permission) => ROLE_PERMISSIONS[role].includes(permission));
    expect(granted('admin')).toEqual(NEW);
    expect(granted('operator')).toEqual(['settings.read', 'settings.email.write']);
    expect(granted('readonly')).toEqual(['settings.read']);
    expect(granted('veterinarian')).toEqual(['nutrition.settings.write']);
    expect(ROLE_PERMISSIONS.veterinarian.some((permission) => permission.startsWith('catalog.') || permission.startsWith('settings.'))).toBe(false);
  });

  test('gives operator catalog.sync', () => {
    expect(ROLE_PERMISSIONS.operator).toContain('catalog.sync');
    expect(ROLE_PERMISSIONS.operator).toContain('billing.coupons.write');
    expect(ROLE_PERMISSIONS.operator).toContain('users.status.write');
    expect(ROLE_PERMISSIONS.operator).toContain('feedbacks.write');
    expect(ROLE_PERMISSIONS.operator).toContain('privacy.requests.write');
    expect(ROLE_PERMISSIONS.operator).toContain('production.read');
    expect(ROLE_PERMISSIONS.operator).toContain('production.write');
    expect(ROLE_PERMISSIONS.operator).not.toContain('users.roles.write');
    expect(ROLE_PERMISSIONS.operator).not.toContain('users.access.write');
    expect(ROLE_PERMISSIONS.operator).not.toContain('market.br');
    expect(ROLE_PERMISSIONS.operator).not.toContain('market.us');
    expect(ROLE_PERMISSIONS.admin).not.toContain('market.br');
    expect(ROLE_PERMISSIONS.admin).not.toContain('market.us');
  });

  test('lets readonly list privacy requests but not write them', () => {
    expect(ROLE_PERMISSIONS.readonly).toContain('privacy.requests.read');
    expect(ROLE_PERMISSIONS.readonly).not.toContain('privacy.requests.write');
    expect(ROLE_PERMISSIONS.veterinarian).not.toContain('privacy.requests.read');
  });

  test('lets readonly list production but not write it', () => {
    expect(ROLE_PERMISSIONS.readonly).toContain('production.read');
    expect(ROLE_PERMISSIONS.readonly).not.toContain('production.write');
    expect(ROLE_PERMISSIONS.veterinarian).not.toContain('production.read');
  });

  test('lets readonly list feedbacks but not write them', () => {
    expect(ROLE_PERMISSIONS.readonly).toContain('feedbacks.read');
    expect(ROLE_PERMISSIONS.readonly).not.toContain('feedbacks.write');
  });

  test('reserves role assignment and access CRUD for admin', async () => {
    expect(ROLE_PERMISSIONS.admin).toContain('users.roles.write');
    expect(ROLE_PERMISSIONS.admin).toContain('users.access.write');
  });

  test('reserves system health for admin', () => {
    expect(ROLE_PERMISSIONS.admin).toContain('system.health.read');
    for (const role of ['operator', 'readonly', 'veterinarian']) {
      expect(ROLE_PERMISSIONS[role]).not.toContain('system.health.read');
    }
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

  test('reads a role stored as nutritionist before the migration as veterinarian', () => {
    expect(parseRoles('["nutritionist"]')).toEqual(['veterinarian']);
    expect(parseRoles('nutritionist,readonly')).toEqual(['veterinarian', 'readonly']);
    expect(parseRoles(['nutritionist', 'veterinarian'])).toEqual(['veterinarian']);
    expect(resolveAdminRoles({ storedRoles: '["nutritionist"]', email: 'lia@edenbowls.com' })).toEqual(['veterinarian']);
    expect(permissionsForRoles(parseRoles('["nutritionist"]'))).toEqual(['nutrition.simulate', 'nutrition.settings.write']);
  });
});
