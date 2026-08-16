const request = require('supertest');
const { createApp } = require('../src/app');
const { HttpError } = require('../src/core/http-error');
const { MARKETS } = require('../src/core/market');

describe('public onboarding plan preview route', () => {
  const payload = {
    subscription_term_months: 1,
    pets: [{
      pet_name: 'Luna',
      enabled: true,
      selected_flavors: ['chicken'],
      flavor_weights: [2]
    }]
  };

  test('creates a quote without bearer authentication', async () => {
    const onboardingPlanPreviewService = {
      previewPlan: jest.fn().mockResolvedValue({
        success: true,
        data: { quote_id: 'q_1', quote_expires_at: '2026-08-14T12:00:00.000Z' }
      })
    };
    const app = createApp({ onboardingPlanPreviewService, corsOrigins: ['http://localhost:5173'] });

    const response = await request(app)
      .post('/api/v1/onboarding/plan/preview')
      .send(payload);

    expect(response.status).toBe(200);
    expect(onboardingPlanPreviewService.previewPlan).toHaveBeenCalledWith({
      userId: null,
      payload,
      market: MARKETS.US
    });
  });

  test('uses BRL when the Brazil market is selected', async () => {
    const onboardingPlanPreviewService = {
      previewPlan: jest.fn().mockResolvedValue({
        success: true,
        data: { currency: 'BRL', quote_id: 'q_1' }
      })
    };
    const app = createApp({ onboardingPlanPreviewService, corsOrigins: ['http://localhost:5173'] });

    const response = await request(app)
      .post('/api/v1/onboarding/plan/preview')
      .send({ ...payload, country: 'BR' });

    expect(response.status).toBe(200);
    expect(onboardingPlanPreviewService.previewPlan).toHaveBeenCalledWith({
      userId: null,
      payload: { ...payload, country: 'BR' },
      market: MARKETS.BR
    });
  });

  test('rejects an invalid preview payload before calling the service', async () => {
    const onboardingPlanPreviewService = { previewPlan: jest.fn() };
    const app = createApp({ onboardingPlanPreviewService, corsOrigins: ['http://localhost:5173'] });

    const response = await request(app)
      .post('/api/v1/onboarding/plan/preview')
      .send({ subscription_term_months: 2, pets: [] });

    expect(response.status).toBe(400);
    expect(onboardingPlanPreviewService.previewPlan).not.toHaveBeenCalled();
  });

  test('forwards semantic preview errors with a public code', async () => {
    const onboardingPlanPreviewService = {
      previewPlan: jest.fn().mockRejectedValue(new HttpError(
        422,
        'Plan preview payload is invalid.',
        { code: 'invalid_plan_preview_payload', errors: { 'pets.0.selected_flavors': 'At least one flavor is required.' } }
      ))
    };
    const app = createApp({ onboardingPlanPreviewService, corsOrigins: ['http://localhost:5173'] });

    const response = await request(app)
      .post('/api/v1/onboarding/plan/preview')
      .send(payload);

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      success: false,
      message: 'Plan preview payload is invalid.',
      code: 'invalid_plan_preview_payload',
      data: {
        status: 422,
        errors: { 'pets.0.selected_flavors': 'At least one flavor is required.' }
      }
    });
  });
});
