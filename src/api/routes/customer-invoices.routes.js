const { HttpError } = require('../../core/http-error');

function registerCustomerInvoicesRoutes(app, dependencies = {}) {
  // The Eden Bowls invoice (EB-YYYY-NNNNNN) of one charge on the customer's own subscription.
  app.get('/api/v1/subscriptions/:subscriptionId/invoices/:invoiceId/pdf', async (request, response, next) => {
    try {
      if (!dependencies.customerInvoicesService) {
        throw new HttpError(503, 'Invoice service is not available.');
      }
      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.customerInvoicesService.downloadForCustomer({
        userId: request.currentUser.id,
        subscriptionId: request.params.subscriptionId,
        stripeInvoiceId: request.params.invoiceId
      });

      response.setHeader('Content-Type', result.contentType);
      response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      response.setHeader('Cache-Control', 'private, no-store');
      response.status(200).send(result.buffer);
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
  });
}

module.exports = {
  registerCustomerInvoicesRoutes
};
