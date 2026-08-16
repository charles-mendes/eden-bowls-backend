const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function issueAccessToken(userId) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

describe('onboarding plan selection routes', () => {
  test('persists a plan selection for the authenticated user', async () => {
    const payload = {
      subscription_term_months: 1,
      pets: [{ pet_id: 'pet-1', pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [500] }]
    };
    const onboardingPlanSelectionService = {
      setPlanSelection: jest.fn().mockResolvedValue({ success: true, data: { plan_selection: payload } })
    };
    const app = createApp({ onboardingPlanSelectionService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/plan-selection')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.session_id).toBeUndefined();
    expect(response.body.data.plan_selection.pets).toHaveLength(1);
    expect(onboardingPlanSelectionService.setPlanSelection).toHaveBeenCalledWith({ userId: 7, payload });
  });

  test('accepts a plan selection without bearer authentication', async () => {
    const payload = { subscription_term_months: 1, pets: [] };
    const onboardingPlanSelectionService = {
      setPlanSelection: jest.fn().mockResolvedValue({
        success: true,
        data: { plan_selection: { ...payload, updated_at: '2026-08-15T23:52:00.000Z' } }
      })
    };
    const app = createApp({ onboardingPlanSelectionService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/plan-selection').send(payload);

    expect(response.status).toBe(200);
    expect(onboardingPlanSelectionService.setPlanSelection).toHaveBeenCalledWith({
      userId: null,
      payload
    });
  });
});
