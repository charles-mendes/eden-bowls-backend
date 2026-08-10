const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding session core routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('starts a new onboarding session', async () => {
    const onboardingSessionCoreService = {
      startSession: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session: { session_id: 'session_123', status: 'active' },
          session_token: 'session-token-123',
          token_type: 'Bearer',
          expires_in: 172800,
          expires_at: '2026-08-10T00:00:00.000Z'
        }
      })
    };

    const app = createApp({
      onboardingSessionCoreService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/start')
      .send({ locale: 'en', country: 'US', state: 'CA' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      data: {
        session: { session_id: 'session_123', status: 'active' },
        session_token: 'session-token-123',
        token_type: 'Bearer',
        expires_in: 172800,
        expires_at: '2026-08-10T00:00:00.000Z'
      }
    });
    expect(onboardingSessionCoreService.startSession).toHaveBeenCalledWith({
      payload: { locale: 'en', country: 'US', state: 'CA' }
    });
  });

  test('returns the session snapshot for an authenticated session token', async () => {
    const onboardingSessionCoreService = {
      getSessionSnapshot: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session_123',
          status: 'active',
          pets: [],
          questionnaire: {},
          recurrence: {},
          plan_selection: {},
          shipping: {},
          zipcode: null,
          locale: 'en',
          country: 'US',
          state: 'CA',
          created_at: '2026-08-01T00:00:00.000Z',
          updated_at: '2026-08-01T00:00:00.000Z'
        }
      })
    };

    const app = createApp({
      onboardingSessionCoreService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .get('/api/v1/onboarding/session/session_123')
      .set('x-session-token', 'session-token-123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session_123',
        status: 'active',
        pets: [],
        questionnaire: {},
        recurrence: {},
        plan_selection: {},
        shipping: {},
        zipcode: null,
        locale: 'en',
        country: 'US',
        state: 'CA',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z'
      }
    });
    expect(onboardingSessionCoreService.getSessionSnapshot).toHaveBeenCalledWith({
      sessionId: 'session_123',
      sessionToken: 'session-token-123',
      currentUser: undefined
    });
  });

  test('refreshes a session token for an authenticated session', async () => {
    const onboardingSessionCoreService = {
      refreshSessionToken: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session_123',
          session_token: 'session-token-456',
          token_type: 'Bearer',
          expires_in: 172800,
          expires_at: '2026-08-10T00:00:00.000Z'
        }
      })
    };

    const app = createApp({
      onboardingSessionCoreService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session_123/token/refresh')
      .set('x-session-token', 'session-token-123')
      .send({ refresh_token: 'refresh-token-123' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session_123',
        session_token: 'session-token-456',
        token_type: 'Bearer',
        expires_in: 172800,
        expires_at: '2026-08-10T00:00:00.000Z'
      }
    });
    expect(onboardingSessionCoreService.refreshSessionToken).toHaveBeenCalledWith({
      sessionId: 'session_123',
      sessionToken: 'session-token-123',
      currentUser: undefined,
      payload: { refresh_token: 'refresh-token-123' }
    });
  });

  test('links an account to the onboarding session', async () => {
    const onboardingSessionCoreService = {
      linkAccount: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session_123',
          status: 'linked',
          linked_user_id: 'user_123',
          pets: [],
          merge_summary: { linked: true, pet_count: 0 }
        }
      })
    };

    const app = createApp({
      onboardingSessionCoreService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session_123/account-link')
      .set('x-session-token', 'session-token-123')
      .set('authorization', 'Bearer session-token-123')
      .send({ account_id: 'account_123' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session_123',
        status: 'linked',
        linked_user_id: 'user_123',
        pets: [],
        merge_summary: { linked: true, pet_count: 0 }
      }
    });
    expect(onboardingSessionCoreService.linkAccount).toHaveBeenCalledWith({
      sessionId: 'session_123',
      sessionToken: 'session-token-123',
      currentUser: undefined,
      payload: { account_id: 'account_123' }
    });
  });
});
