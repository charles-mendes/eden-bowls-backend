const { OnboardingPaymentIntentAckService } = require('../src/services/onboarding-payment-intent-ack.service');

describe('OnboardingPaymentIntentAckService', () => {
  test('checks fresh account status before acknowledging payment intent', async () => {
    const repository = { acknowledge: jest.fn().mockResolvedValue({ acked: true }) };
    const authService = { assertCriticalOperationAllowed: jest.fn().mockResolvedValue({ id: 7 }) };
    const service = new OnboardingPaymentIntentAckService(repository, { authService });
    const payload = { paymentIntentId: 'pi_123', paymentIntentStatus: 'succeeded' };

    await expect(service.acknowledge({ userId: 7, payload })).resolves.toEqual({ success: true, data: { acked: true } });
    expect(authService.assertCriticalOperationAllowed).toHaveBeenCalledWith(7);
    expect(repository.acknowledge).toHaveBeenCalledWith(7, payload);
  });
});
