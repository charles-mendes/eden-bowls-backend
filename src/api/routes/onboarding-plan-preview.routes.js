const { HttpError } = require('../../core/http-error');
const rateLimit = require('express-rate-limit');
const { parseOnboardingPlanPreviewInput } = require('../validators/onboarding-plan-preview.validator');

function registerOnboardingPlanPreviewRoutes(app, dependencies = {}) {
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post('/api/v1/onboarding/plan/preview', limiter, async (request, response, next) => {
    try {
      if (!dependencies.onboardingPlanPreviewService) {
        throw new HttpError(503, 'Onboarding plan preview service is not available.');
      }

      const payload = parseOnboardingPlanPreviewInput(request.body || {});
      const result = await dependencies.onboardingPlanPreviewService.previewPlan({
        userId: request.currentUser && request.currentUser.id ? request.currentUser.id : null,
        payload,
      });

      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        response.status(error.statusCode).json({
          success: false,
          message: error.message
        });
        return;
      }

      next(error);
    }
  });
}

module.exports = {
  registerOnboardingPlanPreviewRoutes
};
