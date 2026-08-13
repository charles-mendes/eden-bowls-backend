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

describe('onboarding recurrence routes', () => {
  test('persists recurrence for the authenticated user', async () => {
    const onboardingRecurrenceService = {
      setRecurrence: jest.fn().mockResolvedValue({
        success: true,
        data: { recurrence: { frequency: 'monthly', period_days: 30, updated_at: '2026-08-13T00:00:00.000Z' } }
      })
    };
    const app = createApp({ onboardingRecurrenceService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/recurrence')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ frequency: '1 month' });

    expect(response.status).toBe(200);
    expect(response.body.data.recurrence.frequency).toBe('monthly');
    expect(response.body.data.session_id).toBeUndefined();
    expect(onboardingRecurrenceService.setRecurrence).toHaveBeenCalledWith({ userId: 7, payload: { frequency: '1 month' } });
  });

  test('requires bearer authentication', async () => {
    const onboardingRecurrenceService = { setRecurrence: jest.fn() };
    const app = createApp({ onboardingRecurrenceService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/recurrence').send({ frequency: 'weekly' });

    expect(response.status).toBe(401);
    expect(onboardingRecurrenceService.setRecurrence).not.toHaveBeenCalled();
  });
});
