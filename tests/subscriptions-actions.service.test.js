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

  test('rejects change_plan as invalid_action', async () => {
    const repository = { executeAction: jest.fn() };
    const authService = { assertCriticalOperationAllowed: jest.fn() };
    const service = new SubscriptionsActionsService(repository, { authService });

    await expect(service.executeAction({
      userId: 7,
      subscriptionId: 'sub_123',
      payload: { action: 'change_plan' }
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_action' }
    });
    expect(repository.executeAction).not.toHaveBeenCalled();
  });

  test('rejects update_payment_method without a pm_ id', async () => {
    const repository = { executeAction: jest.fn() };
    const authService = { assertCriticalOperationAllowed: jest.fn().mockResolvedValue({ id: 7 }) };
    const service = new SubscriptionsActionsService(repository, { authService });

    await expect(service.executeAction({
      userId: 7,
      subscriptionId: 'sub_123',
      payload: { action: 'update_payment_method', payment_method_id: 'card_123' }
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_payment_method' }
    });
    expect(repository.executeAction).not.toHaveBeenCalled();
  });
});