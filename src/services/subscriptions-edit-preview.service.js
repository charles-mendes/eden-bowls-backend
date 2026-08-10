const { HttpError } = require('../core/http-error');

class SubscriptionsEditPreviewService {
  constructor(repository) {
    this.repository = repository;
  }

  async preview({ subscriptionId, payload = {}, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Subscriptions edit preview repository is not available.');
    }

    if (!subscriptionId || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }

    if (!currentUser || !currentUser.id) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.preview(subscriptionId, payload, { currentUser, sessionToken });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  SubscriptionsEditPreviewService
};
