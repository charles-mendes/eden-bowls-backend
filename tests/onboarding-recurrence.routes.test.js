const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding recurrence routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('persists a recurrence for a valid session', async () => {
    const onboardingRecurrenceService = {
      setRecurrence: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session-123',
          recurrence: {
            frequency: 'monthly',
            period_days: 30,
            updated_at: '2026-08-09T00:00:00.000Z'
          }
        }
      })
    };

    const app = createApp({ onboardingRecurrenceService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/recurrence')
      .set('x-session-token', 'token-123')
      .send({ frequency: '1 month' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session-123',
        recurrence: {
          frequency: 'monthly',
          period_days: 30,
          updated_at: '2026-08-09T00:00:00.000Z'
        }
      }
    });
    expect(onboardingRecurrenceService.setRecurrence).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: { frequency: '1 month' },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingRecurrenceService = {
      setRecurrence: jest.fn()
    };

    const app = createApp({ onboardingRecurrenceService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/recurrence')
      .send({ frequency: 'weekly' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingRecurrenceService.setRecurrence).not.toHaveBeenCalled();
  });
});
