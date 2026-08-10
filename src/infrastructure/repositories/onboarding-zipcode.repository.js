class OnboardingZipcodeRepository {
  async saveZipcode(sessionId, payload = {}, context = {}) {
    return {
      session_id: sessionId,
      zipcode: payload
    };
  }
}

module.exports = {
  OnboardingZipcodeRepository
};
