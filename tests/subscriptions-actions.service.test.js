const { SubscriptionsActionsService } = require('../src/services/subscriptions-actions.service');

describe('SubscriptionsActionsService', () => {
  test('checks fresh account status before executing a subscription action', async () => {
    const repository = { executeAction: jest.fn().mockResolvedValue({ action: 'pause' }) };
    const authService = { assertCriticalOperationAllowed: jest.fn().mockResolvedValue({ id: 7 }) };
    const service = new SubscriptionsActionsService(repository, { authService });

    await expect(service.executeAction({ userId: 7, subscriptionId: 'sub_123', payload: { action: 'pause' } }))
      .resolves.toEqual({ success: true, data: { action: 'pause' } });
    expect(authService.assertCriticalOperationAllowed).toHaveBeenCalledWith(7);
    expect(repository.executeAction).toHaveBeenCalledWith(7, 'sub_123', expect.objectContaining({ action: 'pause' }));
  });

  test('does not execute an action when the critical account guard rejects', async () => {
    const repository = { executeAction: jest.fn() };
    const authService = { assertCriticalOperationAllowed: jest.fn().mockRejectedValue(new Error('blocked')) };
    const service = new SubscriptionsActionsService(repository, { authService });

    await expect(service.executeAction({ userId: 7, subscriptionId: 'sub_123', payload: { action: 'pause' } })).rejects.toThrow('blocked');
    expect(repository.executeAction).not.toHaveBeenCalled();
  });
});