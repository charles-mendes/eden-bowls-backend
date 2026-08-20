const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');

class AdminUsersService {
  constructor(options = {}) {
    this.usersRepository = options.usersRepository;
    this.profileService = options.profileService;
    this.profileRepository = options.profileRepository;
  }

  async list(query, pagination) {
    const result = await this.usersRepository.listUsers({
      q: query.q,
      offset: pagination.offset,
      perPage: pagination.perPage
    });

    return paginatedEnvelope({
      items: result.items,
      total: result.total,
      page: pagination.page,
      perPage: pagination.perPage
    });
  }

  async getById(userId) {
    if (!this.profileService) {
      throw new HttpError(503, 'Profile service is not available.');
    }

    const profile = await this.profileService.getProfile({ userId });
    return {
      id: String(profile.id || userId),
      email: profile.email,
      status: profile.accountStatus && profile.accountStatus.hasActiveSubscription ? 'subscriber' : 'active',
      createdAt: profile.createdAt || null,
      profile: {
        fullName: profile.fullName || null,
        phone: profile.phone || null
      },
      delivery: profile.delivery || null
    };
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
