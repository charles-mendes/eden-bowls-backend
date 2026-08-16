const { HttpError } = require('../core/http-error');

class OnboardingPlanSnapshotService {
  constructor(repository) {
    this.repository = repository;
  }

  async getSnapshot({ userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding plan snapshot repository is not available.');
    }

    const data = await this.repository.getSnapshot(userId || null);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPlanSnapshotService
};
