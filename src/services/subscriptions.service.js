const { HttpError } = require('../core/http-error');

class SubscriptionsService {
  constructor(repository) {
    this.repository = repository;
  }

  async listMine({ currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Subscriptions repository is not available.');
    }

    if (!currentUser || !currentUser.id) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.listMine({ currentUser, sessionToken });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  SubscriptionsService
};
