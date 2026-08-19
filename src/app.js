const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const client = require('prom-client');
const { buildBearerTokenMiddleware } = require('./api/middleware/bearer-token.middleware');
const { registerAuthRoutes } = require('./api/routes/auth.routes');
const { registerBreedsRoutes } = require('./api/routes/breeds.routes');
const { registerGeoRoutes } = require('./api/routes/geo.routes');
const { registerProductsRoutes } = require('./api/routes/products.routes');
const { registerOnboardingAddressAutocompleteRoutes } = require('./api/routes/onboarding-address-autocomplete.routes');
const { registerOnboardingDiscountEligibilityRoutes } = require('./api/routes/onboarding-discount-eligibility.routes');
const { registerOnboardingPaymentIntentAckRoutes } = require('./api/routes/onboarding-payment-intent-ack.routes');
const { registerOnboardingPaymentMethodsRoutes } = require('./api/routes/onboarding-payment-methods.routes');
const { registerOnboardingPetCreateRoutes } = require('./api/routes/onboarding-pets-create.routes');
const { registerOnboardingPetUpdateRoutes } = require('./api/routes/onboarding-pets-update.routes');
const { registerOnboardingPetsRoutes } = require('./api/routes/onboarding-pets.routes');
const { registerOnboardingPlanPreviewRoutes } = require('./api/routes/onboarding-plan-preview.routes');
const { registerOnboardingPlanSelectionRoutes } = require('./api/routes/onboarding-plan-selection.routes');
const { registerOnboardingPlanSnapshotRoutes } = require('./api/routes/onboarding-plan-snapshot.routes');
const { registerOnboardingRecommendationRoutes } = require('./api/routes/onboarding-recommendation.routes');
const { registerOnboardingRecurrenceRoutes } = require('./api/routes/onboarding-recurrence.routes');
const { registerOnboardingSalesTaxQuoteRoutes } = require('./api/routes/onboarding-sales-tax-quote.routes');
const { registerOnboardingShippingSelectRoutes } = require('./api/routes/onboarding-shipping-select.routes');
const { registerOnboardingSubscriptionCheckoutRoutes } = require('./api/routes/onboarding-subscription-checkout.routes');
const { registerOnboardingSubscriptionPreviewRoutes } = require('./api/routes/onboarding-subscription-preview.routes');
const { registerOnboardingZipcodeLookupRoutes } = require('./api/routes/onboarding-zipcode-lookup.routes');
const { registerOnboardingZipcodeRoutes } = require('./api/routes/onboarding-zipcode.routes');
const { registerShippingRoutes } = require('./api/routes/shipping.routes');
const { registerSubscriptionsActionsRoutes } = require('./api/routes/subscriptions-actions.routes');
const { registerSubscriptionsDetailRoutes } = require('./api/routes/subscriptions-detail.routes');
const { registerSubscriptionsEditCommitRoutes } = require('./api/routes/subscriptions-edit-commit.routes');
const { registerSubscriptionsEditPreviewRoutes } = require('./api/routes/subscriptions-edit-preview.routes');
const { registerSubscriptionsRoutes } = require('./api/routes/subscriptions.routes');
const { registerStripeWebhookRoutes } = require('./api/routes/stripe-webhook.routes');
const { registerOnboardingPetDeleteRoutes } = require('./api/routes/onboarding-pets-delete.routes');
const { registerOnboardingPetsSyncRoutes } = require('./api/routes/onboarding-pets-sync.routes');
const { registerProfileRoutes } = require('./api/routes/profile.routes');
const { HttpError } = require('./core/http-error');
const path = require('path');

client.collectDefaultMetrics();

function buildCorsConfig(origins = []) {
  return {
    origins: Array.isArray(origins) ? origins : []
  };
}

function corsMiddleware(config) {
  return (request, response, next) => {
    const origin = request.headers.origin;
    const isAllowedOrigin = origin && config.origins.includes(origin);

    if (isAllowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      response.setHeader(
        'Access-Control-Allow-Headers',
        'Accept,Content-Type,Authorization,Origin,X-Requested-With,X-Eden-Country,X-Eden-Domain',
      );
      response.setHeader('Access-Control-Expose-Headers', 'content-type');
    }

    if (request.method === 'OPTIONS') {
      response.status(isAllowedOrigin ? 204 : 403).end();
      return;
    }

    next();
  };
}

function createApp(dependencies = {}) {
  const app = express();
  const corsConfig = buildCorsConfig(dependencies.corsOrigins);

  app.disable('x-powered-by');
  app.use(corsMiddleware(corsConfig));
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    strictTransportSecurity: process.env.NODE_ENV === 'production'
  }));
  app.use('/stripe/v1/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/v1/profile/avatar', express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/avatars', express.static(dependencies.avatarPublicDir || path.join(process.cwd(), 'public', 'avatars')));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use(buildBearerTokenMiddleware({
    authPath: '/api/v1/auth/token',
    jwt: dependencies.jwt || {}
  }));

  app.get('/health', (request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/liveness', (request, response) => {
    response.json({ status: 'alive' });
  });

  app.get('/readiness', (request, response) => {
    response.json({ status: 'ready' });
  });

  app.get('/metrics', async (request, response, next) => {
    try {
      response.set('Content-Type', client.register.contentType);
      response.send(await client.register.metrics());
    } catch (error) {
      next(error);
    }
  });

  registerBreedsRoutes(app, dependencies);
  registerGeoRoutes(app, dependencies);
  registerProductsRoutes(app, dependencies);
  registerAuthRoutes(app, dependencies);
  registerOnboardingAddressAutocompleteRoutes(app, dependencies);
  registerOnboardingDiscountEligibilityRoutes(app, dependencies);
  registerOnboardingPaymentIntentAckRoutes(app, dependencies);
  registerOnboardingPaymentMethodsRoutes(app, dependencies);
  registerOnboardingPetCreateRoutes(app, dependencies);
  registerOnboardingPetUpdateRoutes(app, dependencies);
  registerOnboardingPetsRoutes(app, dependencies);
  registerOnboardingPlanPreviewRoutes(app, dependencies);
  registerOnboardingPlanSelectionRoutes(app, dependencies);
  registerOnboardingPlanSnapshotRoutes(app, dependencies);
  registerOnboardingRecommendationRoutes(app, dependencies);
  registerOnboardingRecurrenceRoutes(app, dependencies);
  registerOnboardingSalesTaxQuoteRoutes(app, dependencies);
  registerOnboardingShippingSelectRoutes(app, dependencies);
  registerOnboardingSubscriptionCheckoutRoutes(app, dependencies);
  registerOnboardingSubscriptionPreviewRoutes(app, dependencies);
  registerOnboardingZipcodeLookupRoutes(app, dependencies);
  registerOnboardingZipcodeRoutes(app, dependencies);
  registerShippingRoutes(app, dependencies);
  registerSubscriptionsActionsRoutes(app, dependencies);
  registerSubscriptionsDetailRoutes(app, dependencies);
  registerSubscriptionsEditPreviewRoutes(app, dependencies);
  registerSubscriptionsEditCommitRoutes(app, dependencies);
  registerSubscriptionsRoutes(app, dependencies);
  registerStripeWebhookRoutes(app, dependencies);
  registerOnboardingPetDeleteRoutes(app, dependencies);
  registerOnboardingPetsSyncRoutes(app, dependencies);
  registerProfileRoutes(app, dependencies);

  app.use((request, response, next) => {
    next(new HttpError(404, 'Route not found.'));
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error.name === 'ZodError') {
      response.status(400).json({
        success: false,
        message: 'Invalid request payload.',
        details: error.issues
      });
      return;
    }

    const statusCode = Number(error.statusCode || error.status || 500);
    const message = statusCode >= 500 ? 'Internal server error.' : error.message;

    response.status(statusCode).json({
      success: false,
      message,
      details: error.details || undefined
    });
  });

  return app;
}

module.exports = {
  createApp
};