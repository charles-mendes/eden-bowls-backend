const { HttpError } = require('../../core/http-error');
const rateLimit = require('express-rate-limit');
const { parseRequestMarket } = require('../validators/market.validator');
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

      const market = parseRequestMarket(request, request.body || {});
      const payload = parseOnboardingPlanPreviewInput(request.body || {});
      const result = await dependencies.onboardingPlanPreviewService.previewPlan({
        userId: request.currentUser && request.currentUser.id ? request.currentUser.id : null,
        payload,
        market
      });

      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        response.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.details.code,
          data: {
            status: error.statusCode,
            errors: error.details.errors || undefined
          }
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
