const { HttpError } = require('../core/http-error');

class OnboardingSessionCoreService {
  constructor(repository) {
    this.repository = repository;
  }

  async startSession({ payload = {} }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding session core repository is not available.');
    }

    const data = await this.repository.startSession(payload);

    return {
      success: true,
      data
    };
  }

  async getSessionSnapshot({ sessionId, sessionToken, currentUser }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding session core repository is not available.');
    }

    if (!sessionId) {
      throw new HttpError(422, 'Invalid session id.', { code: 'invalid_session_id' });
    }

    if (!sessionToken) {
      throw new HttpError(401, 'Session access token is required.', { code: 'session_token_missing' });
    }

    const data = await this.repository.getSessionSnapshot(sessionId, { sessionToken, currentUser });

    return {
      success: true,
      data
    };
  }

  async refreshSessionToken({ sessionId, sessionToken, currentUser, payload = {} }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding session core repository is not available.');
    }

    if (!sessionId) {
      throw new HttpError(422, 'Invalid session id.', { code: 'invalid_session_id' });
    }

    if (!sessionToken) {
      throw new HttpError(401, 'Session access token is required.', { code: 'session_token_missing' });
    }

    const data = await this.repository.refreshSessionToken(sessionId, payload, { sessionToken, currentUser });

    return {
      success: true,
      data
    };
  }

  async linkAccount({ sessionId, sessionToken, currentUser, payload = {} }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding session core repository is not available.');
    }

    if (!sessionId) {
      throw new HttpError(422, 'Invalid session id.', { code: 'invalid_session_id' });
    }

    if (!sessionToken) {
      throw new HttpError(401, 'Session access token is required.', { code: 'session_token_missing' });
    }

    if (!currentUser || !currentUser.id) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.linkAccount(sessionId, payload, { sessionToken, currentUser });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingSessionCoreService
};
