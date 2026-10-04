const { HttpError } = require('../../core/http-error');

function registerCustomerDeliveriesRoutes(app, dependencies = {}) {
  async function handle(request, response, next, action) {
    try {
      if (!dependencies.customerDeliveriesService) {
        throw new HttpError(503, 'Deliveries service is not available.');
      }
      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }
      const subscription = await dependencies.customerDeliveriesService.loadSubscription(
        request.params.subscriptionId,
        request.currentUser.id
      );
      const result = await action(subscription, request.currentUser.id, request);
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        response.status(error.statusCode).json({
          success: false,
          message: error.message,
          details: error.details
        });
        return;
      }
      next(error);
    }
  }

  app.get('/api/v1/subscriptions/:subscriptionId/deliveries', (request, response, next) => {
    handle(request, response, next, (subscription, userId) => (
      dependencies.customerDeliveriesService.read(subscription, userId)
    ));
  });

  app.post('/api/v1/subscriptions/:subscriptionId/deliveries/:deliveryId/skip', (request, response, next) => {
    handle(request, response, next, (subscription, userId) => (
      dependencies.customerDeliveriesService.skip(subscription, userId, {
        deliveryId: request.params.deliveryId
      })
    ));
  });

  app.post('/api/v1/subscriptions/:subscriptionId/deliveries/:deliveryId/reschedule', (request, response, next) => {
    handle(request, response, next, (subscription, userId) => (
      dependencies.customerDeliveriesService.reschedule(subscription, userId, {
        deliveryId: request.params.deliveryId,
        date: request.body && request.body.date
      })
    ));
  });

  app.post('/api/v1/subscriptions/:subscriptionId/deliveries/:deliveryId/packs', (request, response, next) => {
    handle(request, response, next, (subscription, userId) => (
      dependencies.customerDeliveriesService.commitPacks(subscription, userId, {
        deliveryId: request.params.deliveryId
      })
    ));
  });
}

module.exports = {
  registerCustomerDeliveriesRoutes
};
