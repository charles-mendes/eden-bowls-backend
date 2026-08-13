const { HttpError } = require('../core/http-error');

class SubscriptionsDetailService {
  constructor(repository) {
    this.repository = repository;
  }

  async getDetail({ subscriptionId, userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Subscriptions detail repository is not available.');
    }

    if (!subscriptionId || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.getDetail(userId, subscriptionId);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  SubscriptionsDetailService
};
