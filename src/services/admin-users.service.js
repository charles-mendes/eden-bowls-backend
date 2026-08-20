const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const {
  hasOperationalRole,
  isAllowlistedEmail,
  normalizeAssignableRoles,
  parseAdminEmails,
  parseRoles,
  resolveAdminRoles
} = require('../core/admin-roles');

class AdminUsersService {
  constructor(options = {}) {
    this.usersRepository = options.usersRepository;
    this.profileService = options.profileService;
    this.profileRepository = options.profileRepository;
    this.adminEmails = parseAdminEmails(options.adminEmails);
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
      ...this.presentRoles(user)
    };
  }

  async list(query, pagination) {
    const result = await this.usersRepository.listUsers({
      q: query.q,
      offset: pagination.offset,
      perPage: pagination.perPage
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
      status: profile && profile.accountStatus && profile.accountStatus.hasActiveSubscription
        ? 'subscriber'
        : (user.status || 'active'),
      createdAt: (profile && profile.createdAt) || user.createdAt || null,
      profile: {
        fullName: (profile && profile.fullName) || user.displayName || null,
        phone: (profile && profile.phone) || (user.profile && user.profile.phone) || null
      },
      delivery: (profile && profile.delivery) || null,
      ...this.presentRoles(user)
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
      return resolveAdminRoles({
        storedRoles: parseRoles(item.storedRoles),
        email: item.email,
        adminEmails: this.adminEmails
      }).includes('admin');
    }).length;
  }

  async updateRoles(userId, nextRoles, actor = {}) {
    const user = await this.usersRepository.findUserById(userId);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

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

    if (currentEffective.includes('admin') && !nextEffective.includes('admin')) {
      const remainingAdmins = await this.countAdmins(user.id);
      if (remainingAdmins < 1) {
        throw new HttpError(422, 'Cannot remove the last admin.');
      }
    }

    await this.usersRepository.saveStoredRoles(user.id, storedRoles);
    const saved = await this.usersRepository.findUserById(user.id);
    return this.getRoles(saved.id);
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
}

module.exports = {
  AdminUsersService
};
