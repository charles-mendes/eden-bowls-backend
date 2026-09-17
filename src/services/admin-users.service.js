const { HttpError } = require('../core/http-error');
const { AUTH_ERROR } = require('../api/contracts/auth-errors');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const { hashWordpressPassword, verifyWordpressPassword } = require('../core/wordpress-password');
const { generateTemporaryPassword } = require('../core/temporary-password');
const {
  hasOperationalRole,
  isAllowlistedEmail,
  normalizeAssignableRoles,
  parseAdminEmails,
  parseRoles,
  resolveAdminRoles
} = require('../core/admin-roles');
const {
  INVITE_META_KEYS,
  INVITE_RESEND_MAX_ATTEMPTS,
  INVITE_RESEND_WINDOW_SECONDS,
  INVITE_TTL_SECONDS,
  isInviteExpired,
  isMustChangePassword,
  isSoftDeleted
} = require('../core/staff-invite');

class AdminUsersService {
  constructor(options = {}) {
    this.usersRepository = options.usersRepository;
    this.profileService = options.profileService;
    this.profileRepository = options.profileRepository;
    this.refreshTokenRepository = options.refreshTokenRepository || null;
    this.inviteMailer = options.inviteMailer || null;
    this.auditService = options.auditService || null;
    this.adminEmails = parseAdminEmails(options.adminEmails);
    this.adminAppUrl = String(options.adminAppUrl || 'http://localhost:5174').replace(/\/+$/, '');
    this.inviteTtlSeconds = Number(options.inviteTtlSeconds || INVITE_TTL_SECONDS);
    this.hashPassword = typeof options.hashPassword === 'function' ? options.hashPassword : hashWordpressPassword;
    this.verifyPassword = typeof options.verifyPassword === 'function' ? options.verifyPassword : verifyWordpressPassword;
    this.generatePassword = typeof options.generatePassword === 'function' ? options.generatePassword : generateTemporaryPassword;
    this.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => Math.floor(Date.now() / 1000);
  }

  actorCanManageAccess(actor = {}) {
    return Array.isArray(actor.permissions) && actor.permissions.includes('users.access.write');
  }

  presentInvite(user) {
    const mustChangePassword = isMustChangePassword(user.mustChangePassword);
    const deletedAt = user.deletedAt || null;
    const inviteExpiresAt = user.inviteExpiresAt ? Number(user.inviteExpiresAt) : null;

    return {
      mustChangePassword,
      inviteMailStatus: user.inviteMailStatus || null,
      inviteExpiresAt: Number.isFinite(inviteExpiresAt) ? inviteExpiresAt : null,
      inviteExpired: mustChangePassword && isInviteExpired(user.inviteExpiresAt, this.nowProvider()),
      deletedAt
    };
  }

  presentRoles(user) {
    const storedRoles = normalizeAssignableRoles(user.storedRoles);
    const roles = resolveAdminRoles({
      storedRoles,
      email: user.email,
      adminEmails: this.adminEmails
    });

    return {
      storedRoles,
      roles,
      lockedByAllowlist: isAllowlistedEmail(user.email, this.adminEmails)
    };
  }

  presentListItem(user) {
    return {
      id: String(user.id),
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
      profile: user.profile,
      ...this.presentRoles(user),
      ...this.presentInvite(user)
    };
  }

  async audit(action, actor, target, metadata) {
    if (!this.auditService || typeof this.auditService.record !== 'function') {
      return;
    }

    await this.auditService.record({
      action,
      actor,
      target,
      metadata
    });
  }

  toSqlDate(seconds) {
    return new Date(Number(seconds) * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }

  toNicename(value) {
    const slug = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    return slug || 'user';
  }

  async revokeSessions(userId, reason) {
    if (!this.refreshTokenRepository || typeof this.refreshTokenRepository.revokeAllForUser !== 'function') {
      return;
    }

    await this.refreshTokenRepository.revokeAllForUser(userId, reason, this.toSqlDate(this.nowProvider()));
  }

  async list(query, pagination, actor = {}) {
    const includeDeleted = String(query.includeDeleted || '') === '1' && this.actorCanManageAccess(actor);
    const result = await this.usersRepository.listUsers({
      q: query.q,
      offset: pagination.offset,
      perPage: pagination.perPage,
      includeDeleted
    });

    return paginatedEnvelope({
      items: result.items.map((item) => this.presentListItem(item)),
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  async listStaff(query, pagination) {
    const result = await this.usersRepository.listStaff({
      q: query.q,
      offset: pagination.offset,
      perPage: pagination.perPage,
      adminEmails: this.adminEmails
    });

    return {
      ...paginatedEnvelope({
        items: result.items.map((item) => this.presentListItem(item)),
        total: result.total,
        page: pagination.page,
        perPage: pagination.perPage
      }),
      bootstrapEmails: this.adminEmails
    };
  }

  async getById(userId) {
    const user = await this.usersRepository.findUserById(userId);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

    let profile = null;
    if (this.profileService) {
      try {
        profile = await this.profileService.getProfile({ userId });
      } catch (_error) {
        profile = null;
      }
    }

    return {
      id: String(user.id),
      email: profile && profile.email ? profile.email : user.email,
      status: user.status || 'active',
      createdAt: (profile && profile.createdAt) || user.createdAt || null,
      profile: {
        fullName: (profile && profile.fullName) || user.displayName || null,
        phone: (profile && profile.phone) || (user.profile && user.profile.phone) || null
      },
      delivery: (profile && profile.delivery) || null,
      ...this.presentRoles(user),
      ...this.presentInvite(user)
    };
  }

  async getRoles(userId) {
    const user = await this.usersRepository.findUserById(userId);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

    return {
      id: String(user.id),
      email: user.email,
      displayName: user.displayName,
      ...this.presentRoles(user)
    };
  }

  async countAdmins(exceptUserId) {
    const result = await this.usersRepository.listStaff({
      offset: 0,
      perPage: 500,
      adminEmails: this.adminEmails
    });

    return result.items.filter((item) => {
      if (exceptUserId && String(item.id) === String(exceptUserId)) {
        return false;
      }
      if (isSoftDeleted(item.deletedAt)) {
        return false;
      }
      return resolveAdminRoles({
        storedRoles: parseRoles(item.storedRoles),
        email: item.email,
        adminEmails: this.adminEmails
      }).includes('admin');
    }).length;
  }

  assertNotSelf(actor, user, message) {
    if (String(actor.userId) === String(user.id)) {
      throw new HttpError(422, message || 'You cannot change your own account.');
    }
  }

  assertAllowlistRoleChange(user, storedRoles) {
    if (!isAllowlistedEmail(user.email, this.adminEmails)) {
      return;
    }

    if (!storedRoles.includes('admin')) {
      throw new HttpError(422, 'Cannot change the role of an allowlisted account. Effective role remains admin.', {
        code: 'allowlist_role_locked'
      });
    }
  }

  async updateRoles(userId, nextRoles, actor = {}) {
    const user = await this.requireExistingUser(userId);
    const storedRoles = normalizeAssignableRoles(nextRoles);
    const currentEffective = resolveAdminRoles({
      storedRoles: user.storedRoles,
      email: user.email,
      adminEmails: this.adminEmails
    });
    const nextEffective = resolveAdminRoles({
      storedRoles,
      email: user.email,
      adminEmails: this.adminEmails
    });

    if (String(actor.userId) === String(user.id) && !hasOperationalRole(nextEffective)) {
      throw new HttpError(422, 'You cannot remove your own panel access.');
    }

    if (String(actor.userId) === String(user.id) && currentEffective.includes('admin') && !nextEffective.includes('admin')) {
      throw new HttpError(422, 'You cannot demote your own account.');
    }

    this.assertAllowlistRoleChange(user, storedRoles);

    if (currentEffective.includes('admin') && !nextEffective.includes('admin')) {
      const remainingAdmins = await this.countAdmins(user.id);
      if (remainingAdmins < 1) {
        throw new HttpError(422, 'Cannot remove the last admin.');
      }
    }

    await this.usersRepository.saveStoredRoles(user.id, storedRoles);
    await this.audit('roles.update', actor, user, { storedRoles });
    const saved = await this.usersRepository.findUserById(user.id);
    return this.getRoles(saved.id);
  }

  async updateDelivery(userId, payload = {}) {
    if (!this.profileService || typeof this.profileService.updateDelivery !== 'function') {
      throw new HttpError(503, 'Profile service is not available.');
    }

    const user = await this.requireExistingUser(userId);
    const delivery = await this.profileService.updateDelivery({
      userId,
      payload,
      skipAccountCheck: true
    });

    return {
      success: true,
      data: delivery
    };
  }

  async updateStatus(userId, nextStatus, actor = {}) {
    const user = await this.requireExistingUser(userId);
    const roles = resolveAdminRoles({
      storedRoles: user.storedRoles,
      email: user.email,
      adminEmails: this.adminEmails
    });
    const isStaff = hasOperationalRole(roles);

    this.assertNotSelf(actor, user, 'You cannot change your own account status.');

    if (isSoftDeleted(user.deletedAt)) {
      throw new HttpError(422, 'Deleted accounts cannot change status.');
    }

    if (isStaff && !this.actorCanManageAccess(actor)) {
      throw new HttpError(422, 'Cannot change status of a staff account.');
    }

    if (isStaff && isAllowlistedEmail(user.email, this.adminEmails) && nextStatus === 'inactive') {
      throw new HttpError(422, 'Cannot deactivate an allowlisted admin account.', {
        code: 'allowlist_status_locked'
      });
    }

    const current = String(user.status || 'active').trim().toLowerCase() || 'active';
    if (nextStatus === 'active' && current === 'pending') {
      throw new HttpError(422, isStaff
        ? 'Pending staff must complete the first password change. Resend the invitation instead.'
        : 'Pending accounts must complete email verification.');
    }

    await this.usersRepository.saveActivationStatus(user.id, nextStatus);

    if (nextStatus === 'inactive') {
      await this.revokeSessions(user.id, 'account_deactivated');
    }

    await this.audit('status.update', actor, user, { from: current, to: nextStatus });
    return this.getById(user.id);
  }

  async updateDeliveryInstructions(userId, deliveryInstructions) {
    if (!this.profileRepository) {
      throw new HttpError(503, 'Profile repository is not available.');
    }

    const user = await this.profileRepository.findUserById(userId);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

    const saved = await this.profileRepository.mergeAddress(
      user.id,
      { delivery_instructions: String(deliveryInstructions || '').trim() },
      { createIfMissing: true }
    );

    return {
      success: true,
      data: {
        deliveryInstructions: saved && saved.delivery_instructions ? saved.delivery_instructions : ''
      }
    };
  }

  async requireExistingUser(userId) {
    const user = await this.usersRepository.findUserById(userId);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

    return user;
  }

  async createAccess(input, actor = {}) {
    const existingId = await this.usersRepository.findUserIdByEmail(input.email);
    if (existingId) {
      throw new HttpError(AUTH_ERROR.EMAIL_EXISTS.status, AUTH_ERROR.EMAIL_EXISTS.message, {
        code: AUTH_ERROR.EMAIL_EXISTS.code,
        field: 'email'
      });
    }

    this.assertAllowlistRoleChange({ email: input.email }, input.roles);

    const temporaryPassword = this.generatePassword();
    const now = this.nowProvider();
    const expiresAt = now + this.inviteTtlSeconds;
    const created = await this.usersRepository.createUser({
      userLogin: input.email,
      userPass: this.hashPassword(temporaryPassword),
      userNicename: this.toNicename(input.email),
      userEmail: input.email,
      displayName: input.name
    });

    await this.usersRepository.saveActivationStatus(created.id, 'pending');
    await this.usersRepository.saveStoredRoles(created.id, input.roles);
    await this.usersRepository.upsertUserMeta(created.id, INVITE_META_KEYS.mustChangePassword, '1');
    await this.usersRepository.upsertUserMeta(created.id, INVITE_META_KEYS.expiresAt, String(expiresAt));
    await this.usersRepository.upsertUserMeta(created.id, INVITE_META_KEYS.resendCount, '0');
    await this.usersRepository.upsertUserMeta(created.id, INVITE_META_KEYS.resendWindowStart, String(now));

    if (input.phone) {
      await this.usersRepository.upsertUserMeta(created.id, 'billing_phone', input.phone);
    }

    const inviteMailStatus = await this.dispatchInvite({
      id: created.id,
      email: input.email,
      name: input.name,
      roles: resolveAdminRoles({
        storedRoles: input.roles,
        email: input.email,
        adminEmails: this.adminEmails
      }),
      temporaryPassword,
      expiresAt
    });

    await this.audit('access.create', actor, { id: created.id, email: input.email }, {
      roles: input.roles,
      inviteMailStatus
    });

    return this.getById(created.id);
  }

  async updateAccess(userId, patch, actor = {}) {
    const user = await this.requireExistingUser(userId);
    this.assertNotSelf(actor, user, 'You cannot edit your own access this way.');

    if (isSoftDeleted(user.deletedAt)) {
      throw new HttpError(422, 'Deleted accounts cannot be edited.');
    }

    if (patch.name != null) {
      await this.usersRepository.updateDisplayName(user.id, patch.name);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'phone')) {
      if (patch.phone) {
        await this.usersRepository.upsertUserMeta(user.id, 'billing_phone', patch.phone);
      } else {
        await this.usersRepository.deleteUserMeta(user.id, 'billing_phone');
      }
    }

    if (patch.roles) {
      await this.updateRoles(user.id, patch.roles, actor);
    } else {
      await this.audit('access.update', actor, user, {
        name: patch.name,
        phone: Object.prototype.hasOwnProperty.call(patch, 'phone')
      });
    }

    return this.getById(user.id);
  }

  async resendInvite(userId, actor = {}) {
    const user = await this.requireExistingUser(userId);
    this.assertNotSelf(actor, user, 'You cannot resend an invitation to your own account.');

    if (isSoftDeleted(user.deletedAt)) {
      throw new HttpError(422, 'Deleted accounts cannot receive invitations.');
    }

    const roles = resolveAdminRoles({
      storedRoles: user.storedRoles,
      email: user.email,
      adminEmails: this.adminEmails
    });
    if (!hasOperationalRole(roles)) {
      throw new HttpError(422, 'Only staff accounts can receive panel invitations.');
    }

    await this.consumeInviteResend(user);

    const temporaryPassword = this.generatePassword();
    const now = this.nowProvider();
    const expiresAt = now + this.inviteTtlSeconds;

    await this.usersRepository.updatePassword(user.id, this.hashPassword(temporaryPassword));
    await this.usersRepository.saveActivationStatus(user.id, 'pending');
    await this.usersRepository.upsertUserMeta(user.id, INVITE_META_KEYS.mustChangePassword, '1');
    await this.usersRepository.upsertUserMeta(user.id, INVITE_META_KEYS.expiresAt, String(expiresAt));
    await this.revokeSessions(user.id, 'invite_resent');

    const inviteMailStatus = await this.dispatchInvite({
      id: user.id,
      email: user.email,
      name: user.displayName || (user.profile && user.profile.fullName) || user.email,
      roles,
      temporaryPassword,
      expiresAt
    });

    await this.audit('access.invite_resend', actor, user, { inviteMailStatus });
    return this.getById(user.id);
  }

  async consumeInviteResend(user) {
    const now = this.nowProvider();
    const windowStart = Number(user.inviteResendWindowStart || 0);
    const count = Number(user.inviteResendCount || 0);
    const windowExpired = !windowStart || now - windowStart >= INVITE_RESEND_WINDOW_SECONDS;

    if (windowExpired) {
      await this.usersRepository.upsertUserMeta(user.id, INVITE_META_KEYS.resendCount, '1');
      await this.usersRepository.upsertUserMeta(user.id, INVITE_META_KEYS.resendWindowStart, String(now));
      return;
    }

    if (count >= INVITE_RESEND_MAX_ATTEMPTS) {
      throw new HttpError(
        AUTH_ERROR.INVITE_RESEND_RATE_LIMITED.status,
        AUTH_ERROR.INVITE_RESEND_RATE_LIMITED.message,
        { code: AUTH_ERROR.INVITE_RESEND_RATE_LIMITED.code }
      );
    }

    await this.usersRepository.upsertUserMeta(user.id, INVITE_META_KEYS.resendCount, String(count + 1));
  }

  async softDelete(userId, actor = {}) {
    const user = await this.requireExistingUser(userId);
    this.assertNotSelf(actor, user, 'You cannot delete your own account.');

    if (isAllowlistedEmail(user.email, this.adminEmails)) {
      throw new HttpError(422, 'Cannot delete an allowlisted admin account.', {
        code: 'allowlist_delete_locked'
      });
    }

    const roles = resolveAdminRoles({
      storedRoles: user.storedRoles,
      email: user.email,
      adminEmails: this.adminEmails
    });
    if (roles.includes('admin')) {
      const remainingAdmins = await this.countAdmins(user.id);
      if (remainingAdmins < 1) {
        throw new HttpError(422, 'Cannot remove the last admin.');
      }
    }

    const deletedAt = this.toSqlDate(this.nowProvider());
    await this.usersRepository.upsertUserMeta(user.id, INVITE_META_KEYS.deletedAt, deletedAt);
    await this.usersRepository.saveActivationStatus(user.id, 'inactive');
    await this.revokeSessions(user.id, 'account_deleted');
    await this.audit('access.soft_delete', actor, user, { deletedAt });

    return {
      success: true,
      id: String(user.id),
      deletedAt
    };
  }

  async completePasswordChange(actor, payload) {
    const user = await this.requireExistingUser(actor.userId);
    if (isSoftDeleted(user.deletedAt)) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    if (!isMustChangePassword(user.mustChangePassword)) {
      throw new HttpError(422, 'This account does not require a first-login password change.');
    }

    if (isInviteExpired(user.inviteExpiresAt, this.nowProvider())) {
      throw new HttpError(AUTH_ERROR.INVITE_EXPIRED.status, AUTH_ERROR.INVITE_EXPIRED.message, {
        code: AUTH_ERROR.INVITE_EXPIRED.code
      });
    }

    const currentHash = await this.usersRepository.getUserPass(user.id);
    if (!this.verifyPassword(payload.currentPassword, currentHash)) {
      throw new HttpError(422, 'Current password is incorrect.', {
        code: 'invalid_password',
        field: 'currentPassword'
      });
    }

    await this.usersRepository.updatePassword(user.id, this.hashPassword(payload.newPassword));
    await this.usersRepository.saveActivationStatus(user.id, 'active');
    await this.usersRepository.upsertUserMeta(user.id, INVITE_META_KEYS.mustChangePassword, '0');
    await this.usersRepository.deleteUserMeta(user.id, INVITE_META_KEYS.expiresAt);
    await this.usersRepository.upsertUserMeta(
      user.id,
      'hsr_email_verified_at',
      new Date(this.nowProvider() * 1000).toISOString()
    );
    await this.usersRepository.upsertUserMeta(user.id, '_eden_pwd_updated_at', this.toSqlDate(this.nowProvider()));
    await this.revokeSessions(user.id, 'password_changed');
    await this.audit('access.password_changed', actor, user, {});

    return {
      success: true,
      mustChangePassword: false
    };
  }

  async dispatchInvite({ id, email, name, roles, temporaryPassword, expiresAt }) {
    if (!this.inviteMailer || typeof this.inviteMailer.sendInviteEmail !== 'function') {
      await this.usersRepository.upsertUserMeta(id, INVITE_META_KEYS.mailStatus, 'skipped');
      return 'skipped';
    }

    try {
      await this.inviteMailer.sendInviteEmail({
        to: email,
        name,
        temporaryPassword,
        roles,
        panelUrl: this.adminAppUrl,
        expiresAt
      });
      await this.usersRepository.upsertUserMeta(id, INVITE_META_KEYS.mailStatus, 'sent');
      return 'sent';
    } catch (_error) {
      await this.usersRepository.upsertUserMeta(id, INVITE_META_KEYS.mailStatus, 'failed');
      return 'failed';
    }
  }
}

module.exports = {
  AdminUsersService
};
