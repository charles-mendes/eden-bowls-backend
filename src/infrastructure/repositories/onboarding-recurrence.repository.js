class OnboardingRecurrenceRepository {
  async setRecurrence(sessionId, recurrence, context = {}) {
    return {
      session_id: sessionId,
      recurrence: {
        frequency: recurrence.frequency,
        period_days: recurrence.periodDays,
        updated_at: '2026-08-09T00:00:00.000Z'
      }
    };
  }
}

module.exports = {
  OnboardingRecurrenceRepository
};
