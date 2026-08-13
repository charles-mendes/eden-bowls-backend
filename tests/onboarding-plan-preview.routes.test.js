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

describe('onboarding plan preview routes', () => {
  test('returns a plan preview for the authenticated user', async () => {
    const payload = {
      subscription_term_months: 1,
      pets: [{ pet_id: 'pet-1', pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [500] }]
    };
    const onboardingPlanPreviewService = {
      previewPlan: jest.fn().mockResolvedValue({
        success: true,
        data: {
          subscription_term_months: 1,
          currency: 'USD',
          totals: { grand_total: 20, grand_total_monthly: 20, first_month_total: 20 },
          pricing: { grand_total: 20, grand_total_monthly: 20, first_month_total: 20 },
          pets: [{ pet_id: 'pet-1', pet_name: 'Milo', monthly_total: 20, total: 20, first_month_total: 20 }],
          line_items: []
        }
      })
    };
    const app = createApp({ onboardingPlanPreviewService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/plan/preview')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.session_id).toBeUndefined();
    expect(response.body.data.totals.grand_total).toBe(20);
    expect(onboardingPlanPreviewService.previewPlan).toHaveBeenCalledWith({ userId: 7, payload });
  });

  test('requires bearer authentication', async () => {
    const onboardingPlanPreviewService = { previewPlan: jest.fn() };
    const app = createApp({ onboardingPlanPreviewService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/plan/preview').send({ pets: [] });

    expect(response.status).toBe(401);
    expect(onboardingPlanPreviewService.previewPlan).not.toHaveBeenCalled();
  });
});
