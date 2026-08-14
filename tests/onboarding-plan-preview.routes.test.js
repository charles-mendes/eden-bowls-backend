const request = require('supertest');
const { createApp } = require('../src/app');

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
      payload
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
});
