class SubscriptionsRepository {
  async listMine() {
    return {
      subscriptions: [],
      count: 0
    };
  }
}

module.exports = {
  SubscriptionsRepository
};
