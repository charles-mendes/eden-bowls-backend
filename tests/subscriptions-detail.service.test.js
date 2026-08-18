const { SubscriptionsDetailService } = require('../src/services/subscriptions-detail.service');

describe('SubscriptionsDetailService', () => {
  test('returns 404 when the repository has no row for the user', async () => {
    const repository = { getDetail: jest.fn().mockResolvedValue(null) };
    const service = new SubscriptionsDetailService(repository);

    await expect(service.getDetail({ userId: 7, subscriptionId: 'sub_missing' })).rejects.toMatchObject({
      statusCode: 404,
      details: { code: 'subscription_not_found' }
    });
  });

  test('returns 422 for an invalid subscription id', async () => {
    const repository = { getDetail: jest.fn() };
    const service = new SubscriptionsDetailService(repository);

    await expect(service.getDetail({ userId: 7, subscriptionId: 'abc' })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_subscription_id' }
    });
    expect(repository.getDetail).not.toHaveBeenCalled();
  });
});
