const { MAX_TRANSIT_DAYS_US } = require('../../core/delivery-closed-days');

// Checkout estimate of the first delivery, projected from now with the same rule the production queue applies
// to the payment. It is an estimate: the queue recalculates from the real payment time.
function registerDeliveryEstimateRoutes(app, dependencies = {}) {
  app.get('/api/v1/onboarding/delivery-estimate', async (request, response, next) => {
    try {
      const estimator = dependencies.deliveryEstimator;
      if (!estimator) {
        response.status(503).json({ success: false, message: 'Delivery estimate is not available.' });
        return;
      }
      const country = String(request.query.country || '').trim().toUpperCase();
      if (country !== 'BR' && country !== 'US') {
        response.status(422).json({ success: false, message: 'country must be BR or US.', details: { code: 'invalid_country' } });
        return;
      }
      const transitDays = country === 'US' ? Number(request.query.transit_days) : 0;
      if (country === 'US' && (!Number.isInteger(transitDays) || transitDays < 0)) {
        response.status(422).json({ success: false, message: 'transit_days is required for US.', details: { code: 'invalid_transit_days' } });
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      if (country === 'US' && transitDays > MAX_TRANSIT_DAYS_US) {
        response.status(200).json({ success: true, data: { country, available: false } });
        return;
      }
      const now = typeof dependencies.now === 'function' ? dependencies.now() : new Date();
      const estimate = await estimator.estimate({ market: country, at: now, transitDays });
      response.status(200).json({
        success: true,
        data: estimate
          ? { country, available: true, estimated_from: now.toISOString(), preparation_day: estimate.preparationDay, delivery_date: estimate.deliveryDate }
          : { country, available: false }
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerDeliveryEstimateRoutes
};
