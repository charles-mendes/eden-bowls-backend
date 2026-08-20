const { HttpError } = require('../core/http-error');
const {
  ADMIN_ROLES_META_KEY,
  hasOperationalRole,
  parseAdminEmails,
  permissionsForRoles,
  resolveAdminRoles
} = require('../core/admin-roles');

class AdminIdentityService {
  constructor(options = {}) {
    this.authRepository = options.authRepository || null;
    this.authService = options.authService || null;
    this.adminEmails = parseAdminEmails(options.adminEmails);
  }

  async resolve(userId) {
    if (!this.authRepository) {
      throw new HttpError(503, 'Auth repository is not available.');
    }

    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new HttpError(401, 'Authentication is required.');
    }

    const storedRoles = typeof this.authRepository.getUserMeta === 'function'
      ? await this.authRepository.getUserMeta(user.id, ADMIN_ROLES_META_KEY)
      : '';
    const roles = resolveAdminRoles({
      storedRoles,
      email: user.user_email,
      adminEmails: this.adminEmails
    });

    return {
      userId: String(user.id),
      email: String(user.user_email || ''),
      roles,
      permissions: permissionsForRoles(roles)
    };
  }

  async requireOperational(userId) {
    const identity = await this.resolve(userId);

    if (!hasOperationalRole(identity.roles)) {
      throw new HttpError(403, 'Forbidden.');
    }

    if (this.authService && typeof this.authService.assertCriticalOperationAllowed === 'function') {
      await this.authService.assertCriticalOperationAllowed(userId);
    }

    return identity;
  }
}

module.exports = {
  AdminIdentityService
};
