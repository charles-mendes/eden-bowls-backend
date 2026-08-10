class OnboardingSessionCoreRepository {
  async startSession(payload = {}) {
    return {
      session: {
        session_id: 'session_123',
        status: 'active',
        locale: payload.locale || 'en',
        country: payload.country || 'US',
        state: payload.state || null
      },
      session_token: 'session-token-123',
      token_type: 'Bearer',
      expires_in: 172800,
      expires_at: '2026-08-10T00:00:00.000Z'
    };
  }

  async getSessionSnapshot(sessionId, context = {}) {
    return {
      session_id: sessionId,
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
    };
  }

  async refreshSessionToken(sessionId, payload = {}, context = {}) {
    return {
      session_id: sessionId,
      session_token: 'session-token-123',
      token_type: 'Bearer',
      expires_in: 172800,
      expires_at: '2026-08-10T00:00:00.000Z'
    };
  }

  async linkAccount(sessionId, payload = {}, context = {}) {
    return {
      session_id: sessionId,
      status: 'linked',
      linked_user_id: context.currentUser && context.currentUser.id ? context.currentUser.id : 'user-1',
      pets: [],
      merge_summary: {
        linked: true,
        pet_count: 0
      }
    };
  }
}

module.exports = {
  OnboardingSessionCoreRepository
};
