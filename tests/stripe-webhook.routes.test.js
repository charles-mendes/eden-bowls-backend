const request = require('supertest');
const { createApp } = require('../src/app');
const { HttpError } = require('../src/core/http-error');

describe('stripe webhook routes', () => {
  test('returns 200 without JWT', async () => {
    const stripeWebhookService = {
      handle: jest.fn().mockResolvedValue({ received: true })
    };
    const app = createApp({ stripeWebhookService });

    const response = await request(app)
      .post('/stripe/v1/webhook')
      .set('Stripe-Signature', 't=1,v1=abc')
      .send({ id: 'evt_1', type: 'invoice.paid' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(stripeWebhookService.handle).toHaveBeenCalled();
  });

  test('returns 400 when the signature is invalid', async () => {
    const stripeWebhookService = {
      handle: jest.fn().mockRejectedValue(new HttpError(400, 'Invalid Stripe signature.', {
        code: 'stripe_webhook_signature_invalid'
      }))
    };
    const app = createApp({ stripeWebhookService });

    const response = await request(app)
      .post('/stripe/v1/webhook')
      .send({ id: 'evt_1' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ received: false });
  });

  test('returns 503 when the webhook secret is missing', async () => {
    const stripeWebhookService = {
      handle: jest.fn().mockRejectedValue(new HttpError(503, 'STRIPE_WEBHOOK_SECRET is not configured.', {
        code: 'stripe_webhook_secret_missing'
      }))
    };
    const app = createApp({ stripeWebhookService });

    const response = await request(app)
      .post('/stripe/v1/webhook')
      .set('Stripe-Signature', 't=1,v1=abc')
      .send({ id: 'evt_1' });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ received: false });
  });

  test('does not require Authorization', async () => {
    const stripeWebhookService = {
      handle: jest.fn().mockResolvedValue({ received: true })
    };
    const app = createApp({
      stripeWebhookService,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/stripe/v1/webhook')
      .set('Stripe-Signature', 't=1,v1=abc')
      .send({ id: 'evt_1', type: 'invoice.paid' });

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(200);
  });
});
