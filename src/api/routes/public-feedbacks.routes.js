const { HttpError } = require('../../core/http-error');
const { parsePublicFeedbackQuery } = require('../validators/feedbacks.validator');

function registerPublicFeedbacksRoutes(app, dependencies = {}) {
  app.get('/api/v1/public/feedbacks', async (request, response, next) => {
    try {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }

      const query = parsePublicFeedbackQuery(request.query || {});
      const payload = await dependencies.feedbacksService.listPublic(query);
      response.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerPublicFeedbacksRoutes
};
