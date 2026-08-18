const { OnboardingPaymentIntentAckRepository } = require('../src/infrastructure/repositories/onboarding-payment-intent-ack.repository');

describe('OnboardingPaymentIntentAckRepository', () => {
  test('updates the matching payment intent only in the user checkout reference', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest
        .fn()
        .mockResolvedValueOnce([{ checkout_reference: JSON.stringify({ order_id: 101, stripe_payment_intent_id: 'pi_123' }) }])
        .mockResolvedValueOnce({ affectedRows: 1 })
    };
    const repository = new OnboardingPaymentIntentAckRepository(dataSource);

    const result = await repository.acknowledge(7, { paymentIntentId: 'pi_123', paymentIntentStatus: 'succeeded' });

    expect(result).toEqual(expect.objectContaining({
      order_id: 101,
      stripe_payment_intent_id: 'pi_123',
      stripe_payment_intent_status: 'succeeded',
      payment_state: 'paid',
      acked: true
    }));
    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM `onboarding_user_state` WHERE `user_id` = ?'),
      [7]
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE `onboarding_user_state` SET `checkout_reference` = ? WHERE `user_id` = ?'),
      [expect.stringContaining('"stripe_payment_intent_id":"pi_123"'), 7]
    );
  });

  test('rejects a payment intent that does not belong to the user checkout', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ checkout_reference: JSON.stringify({ stripe_payment_intent_id: 'pi_owner' }) }])
    };
    const repository = new OnboardingPaymentIntentAckRepository(dataSource);

    await expect(repository.acknowledge(7, { paymentIntentId: 'pi_foreign', paymentIntentStatus: 'succeeded' })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'payment_intent_mismatch' }
    });
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  test('marks requires_capture as paid', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest
        .fn()
        .mockResolvedValueOnce([{ checkout_reference: JSON.stringify({ order_id: 101, stripe_payment_intent_id: 'pi_123' }) }])
        .mockResolvedValueOnce({ affectedRows: 1 })
    };
    const repository = new OnboardingPaymentIntentAckRepository(dataSource);

    const result = await repository.acknowledge(7, { paymentIntentId: 'pi_123', paymentIntentStatus: 'requires_capture' });

    expect(result.payment_state).toBe('paid');
  });
});
