const { HttpError } = require('../core/http-error');
const { AUTH_ERROR } = require('../api/contracts/auth-errors');
const {
  ADMIN_ROLES_META_KEY,
  hasOperationalRole,
  parseAdminEmails,
  permissionsForRoles,
  resolveAdminRoles
} = require('../core/admin-roles');
const {
  INVITE_META_KEYS,
  isInviteExpired,
  isMustChangePassword,
  isSoftDeleted
} = require('../core/staff-invite');

class AdminIdentityService {
  constructor(options = {}) {
    this.authRepository = options.authRepository || null;
    this.authService = options.authService || null;
    this.adminEmails = parseAdminEmails(options.adminEmails);
    this.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => Math.floor(Date.now() / 1000);
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

    const invite = await this.loadInviteState(user.id);

    return {
      userId: String(user.id),
      email: String(user.user_email || ''),
      roles,
      permissions: permissionsForRoles(roles),
      mustChangePassword: invite.mustChangePassword,
      inviteExpiresAt: invite.inviteExpiresAt,
      deletedAt: invite.deletedAt,
      activationStatus: String(user.activation_status || '').trim().toLowerCase()
    };
  }

  async loadInviteState(userId) {
    if (!this.authRepository || typeof this.authRepository.getUserMeta !== 'function') {
      return {
        mustChangePassword: false,
        inviteExpiresAt: null,
        deletedAt: ''
      };
    }

    const [mustChangePassword, inviteExpiresAt, deletedAt] = await Promise.all([
      this.authRepository.getUserMeta(userId, INVITE_META_KEYS.mustChangePassword),
      this.authRepository.getUserMeta(userId, INVITE_META_KEYS.expiresAt),
      this.authRepository.getUserMeta(userId, INVITE_META_KEYS.deletedAt)
    ]);
    const expires = Number(inviteExpiresAt);

    return {
      mustChangePassword: isMustChangePassword(mustChangePassword),
      inviteExpiresAt: Number.isFinite(expires) && expires > 0 ? expires : null,
      deletedAt
    };
  }

  async requireOperational(userId) {
    const identity = await this.resolve(userId);

    if (!hasOperationalRole(identity.roles)) {
      throw new HttpError(403, 'Forbidden.');
    }

    if (isSoftDeleted(identity.deletedAt)) {
      throw new HttpError(403, AUTH_ERROR.ACCOUNT_INACTIVE.message, {
        code: AUTH_ERROR.ACCOUNT_INACTIVE.code
      });
    }

    if (identity.mustChangePassword) {
      if (isInviteExpired(identity.inviteExpiresAt, this.nowProvider())) {
        throw new HttpError(AUTH_ERROR.INVITE_EXPIRED.status, AUTH_ERROR.INVITE_EXPIRED.message, {
          code: AUTH_ERROR.INVITE_EXPIRED.code
        });
      }

      return identity;
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
