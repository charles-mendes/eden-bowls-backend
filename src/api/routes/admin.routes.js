const { HttpError } = require('../../core/http-error');
const { buildRequireAdminPermission } = require('../middleware/require-admin-permission.middleware');
const { parseNutritionSimulateInput } = require('../validators/admin-nutrition-simulate.validator');
const { parseRolesAssignmentInput } = require('../validators/admin-users-roles.validator');
const { parseShippingSettingsInput, parseShippingTestInput } = require('../validators/admin-shipping.validator');
const { parseCreateCouponInput, parsePromoMappingInput } = require('../validators/admin-coupons.validator');
const { parsePageQuery } = require('../validators/admin-pagination');
const { parseAccountStatusInput } = require('../validators/admin-users-status.validator');
const {
  parseCreateFeedbackInput,
  parseFeedbackActiveInput,
  parseFeedbackId,
  parseFeedbackListQuery,
  parseUpdateFeedbackInput
} = require('../validators/feedbacks.validator');

function registerAdminRoutes(app, dependencies = {}) {
  const requirePermission = buildRequireAdminPermission(dependencies);

  async function handle(response, next, action) {
    try {
      const result = await action();
      if (result && result.redirect) {
        response.redirect(302, result.redirect);
        return;
      }
      if (result && result.csv) {
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', `attachment; filename="${result.filename || 'export.csv'}"`);
        response.status(200).send(result.csv);
        return;
      }
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  app.get('/api/v1/admin/me', requirePermission(), async (request, response, next) => {
    await handle(response, next, async () => request.adminIdentity);
  });

  app.post('/api/v1/admin/nutrition/simulate', requirePermission('nutrition.simulate'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminNutritionService) {
        throw new HttpError(503, 'Nutrition service is not available.');
      }
      return dependencies.adminNutritionService.simulate(parseNutritionSimulateInput(request.body || {}));
    });
  });

  app.get('/api/v1/admin/shipping/settings', requirePermission('shipping.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminShippingService) {
        throw new HttpError(503, 'Shipping service is not available.');
      }
      return dependencies.adminShippingService.getSettings();
    });
  });

  app.put('/api/v1/admin/shipping/settings', requirePermission('shipping.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminShippingService) {
        throw new HttpError(503, 'Shipping service is not available.');
      }
      return dependencies.adminShippingService.saveSettings(parseShippingSettingsInput(request.body || {}));
    });
  });

  app.post('/api/v1/admin/shipping/test', requirePermission('shipping.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminShippingService) {
        throw new HttpError(503, 'Shipping service is not available.');
      }
      return dependencies.adminShippingService.test(parseShippingTestInput(request.body || {}));
    });
  });

  app.get('/api/v1/admin/onboarding/checkouts.csv', requirePermission('onboarding.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return {
        csv: await dependencies.adminOnboardingService.csv(request.query || {}),
        filename: 'onboarding-checkouts.csv'
      };
    });
  });

  app.get('/api/v1/admin/onboarding/checkouts', requirePermission('onboarding.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.list(request.query || {}, parsePageQuery(request.query, { defaultPerPage: 20 }));
    });
  });

  app.get('/api/v1/admin/onboarding/checkouts/:userId', requirePermission('onboarding.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.getByUserId(request.params.userId);
    });
  });

  app.get('/api/v1/admin/onboarding/metrics', requirePermission('onboarding.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.metrics(request.query || {});
    });
  });

  app.get('/api/v1/admin/onboarding/sessions', requirePermission('onboarding.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.list(request.query || {}, parsePageQuery(request.query, { defaultPerPage: 20 }));
    });
  });

  app.get('/api/v1/admin/onboarding/sessions/:userId', requirePermission('onboarding.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.getByUserId(request.params.userId);
    });
  });

  app.get('/api/v1/admin/catalog/products', requirePermission('catalog.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.listProducts(request.query || {}, parsePageQuery(request.query));
    });
  });

  app.post('/api/v1/admin/catalog/products', requirePermission('catalog.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.createProduct(request.body || {});
    });
  });

  app.get('/api/v1/admin/catalog/products/:productId', requirePermission('catalog.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.getProduct(request.params.productId);
    });
  });

  app.patch('/api/v1/admin/catalog/products/:productId', requirePermission('catalog.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.patchProduct(request.params.productId, request.body || {});
    });
  });

  app.delete('/api/v1/admin/catalog/products/:productId/variations/:variationId', requirePermission('catalog.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.deleteVariation(request.params.productId, request.params.variationId);
    });
  });

  app.delete('/api/v1/admin/catalog/products/:productId', requirePermission('catalog.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.deleteProduct(request.params.productId);
    });
  });

  app.get('/api/v1/admin/catalog/pricing', requirePermission('catalog.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.listPricing(request.query || {}, parsePageQuery(request.query));
    });
  });

  async function handleCatalogSync(request, response, next, extra = {}) {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.sync({
        market: request.body && request.body.market,
        currency: request.body && request.body.currency,
        ...extra
      });
    });
  }

  async function handleCatalogHealth(request, response, next) {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.health(request.query || {});
    });
  }

  async function handleCatalogStatus(request, response, next) {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.status();
    });
  }

  app.post('/api/v1/admin/catalog/sync', requirePermission('catalog.sync'), (request, response, next) => {
    void handleCatalogSync(request, response, next);
  });
  app.post('/api/v1/admin/catalog/sync/:productId', requirePermission('catalog.sync'), (request, response, next) => {
    void handleCatalogSync(request, response, next, { productId: request.params.productId });
  });
  app.get('/api/v1/admin/catalog/sync/health', requirePermission('catalog.read'), handleCatalogHealth);
  app.get('/api/v1/admin/catalog/sync/status', requirePermission('catalog.read'), handleCatalogStatus);

  app.post('/api/v1/billing/catalog/sync', requirePermission('catalog.sync'), (request, response, next) => {
    void handleCatalogSync(request, response, next);
  });
  app.post('/api/v1/billing/catalog/sync/:productId', requirePermission('catalog.sync'), (request, response, next) => {
    void handleCatalogSync(request, response, next, { productId: request.params.productId });
  });
  app.get('/api/v1/billing/catalog/sync/health', requirePermission('catalog.read'), handleCatalogHealth);
  app.get('/api/v1/billing/catalog/sync/status', requirePermission('catalog.read'), handleCatalogStatus);

  app.get('/api/v1/admin/billing/subscriptions', requirePermission('billing.subscribers.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.listSubscriptions(request.query || {}, parsePageQuery(request.query, { defaultPerPage: 20 }));
    });
  });

  app.get('/api/v1/admin/billing/subscriptions/:id', requirePermission('billing.subscribers.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.getSubscription(request.params.id);
    });
  });

  app.get('/api/v1/admin/billing/metrics', requirePermission('billing.subscribers.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.metrics();
    });
  });

  app.post('/api/v1/admin/billing/subscriptions/reconcile', requirePermission('billing.subscribers.sync'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.reconcile();
    });
  });

  app.post('/api/v1/admin/billing/subscriptions/backfill-links', requirePermission('billing.subscribers.sync'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.backfillLinks();
    });
  });

  app.post('/api/v1/admin/billing/subscriptions/:id/sync-invoices', requirePermission('billing.subscribers.sync'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.syncInvoices(request.params.id);
    });
  });

  app.get('/api/v1/admin/billing/invoices/:id/pdf', requirePermission('billing.subscribers.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return { url: await dependencies.adminBillingService.invoicePdfUrl(request.params.id) };
    });
  });

  app.get('/api/v1/admin/billing/webhooks', requirePermission('billing.subscribers.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.listWebhooks(
        parsePageQuery(request.query),
        request.query && (request.query.type || request.query.state)
      );
    });
  });

  app.get('/api/v1/admin/stripe/first-purchase-promos', requirePermission('billing.coupons.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      return dependencies.stripeCouponService.mappingHealth();
    });
  });

  app.put('/api/v1/admin/stripe/first-purchase-promos', requirePermission('billing.coupons.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      return dependencies.stripeCouponService.saveMapping(parsePromoMappingInput(request.body || {}));
    });
  });

  app.post('/api/v1/admin/stripe/first-purchase-promos/sync', requirePermission('billing.coupons.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      return dependencies.stripeCouponService.syncFirstPurchasePromos();
    });
  });

  app.post('/api/v1/admin/stripe/first-purchase-coupons', requirePermission('billing.coupons.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      return dependencies.stripeCouponService.createFirstPurchaseCoupon(parseCreateCouponInput(request.body || {}));
    });
  });

  app.get('/api/v1/admin/stripe/promotion-codes', requirePermission('billing.coupons.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      try {
        return await dependencies.stripeCouponService.listRecentPromotionCodes(25);
      } catch (error) {
        return {
          success: false,
          message: error.message || 'Unable to list Stripe promotion codes.'
        };
      }
    });
  });

  app.get('/api/v1/admin/users', requirePermission('users.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.list(request.query || {}, parsePageQuery(request.query));
    });
  });

  app.get('/api/v1/admin/users/roles', requirePermission('users.roles.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.listStaff(request.query || {}, parsePageQuery(request.query, { defaultPerPage: 50 }));
    });
  });

  app.get('/api/v1/admin/users/:userId', requirePermission('users.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.getById(request.params.userId);
    });
  });

  app.get('/api/v1/admin/users/:userId/roles', requirePermission('users.roles.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.getRoles(request.params.userId);
    });
  });

  app.put('/api/v1/admin/users/:userId/roles', requirePermission('users.roles.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.updateRoles(
        request.params.userId,
        parseRolesAssignmentInput(request.body || {}),
        request.adminIdentity
      );
    });
  });

  app.patch('/api/v1/admin/users/:userId/delivery', requirePermission('users.delivery.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.updateDelivery(request.params.userId, request.body || {});
    });
  });

  app.patch('/api/v1/admin/users/:userId/delivery-instructions', requirePermission('users.delivery.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.updateDeliveryInstructions(
        request.params.userId,
        request.body && request.body.deliveryInstructions
      );
    });
  });

  app.patch('/api/v1/admin/users/:userId/status', requirePermission('users.status.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.updateStatus(
        request.params.userId,
        parseAccountStatusInput(request.body || {}),
        request.adminIdentity
      );
    });
  });

  app.get('/api/v1/admin/feedbacks', requirePermission('feedbacks.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.list(parseFeedbackListQuery(request.query || {}));
    });
  });

  app.post('/api/v1/admin/feedbacks', requirePermission('feedbacks.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.create(parseCreateFeedbackInput(request.body || {}));
    });
  });

  app.get('/api/v1/admin/feedbacks/:id', requirePermission('feedbacks.read'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.getById(parseFeedbackId(request.params.id));
    });
  });

  app.patch('/api/v1/admin/feedbacks/:id/active', requirePermission('feedbacks.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.setActive(
        parseFeedbackId(request.params.id),
        parseFeedbackActiveInput(request.body || {})
      );
    });
  });

  app.patch('/api/v1/admin/feedbacks/:id', requirePermission('feedbacks.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.update(
        parseFeedbackId(request.params.id),
        parseUpdateFeedbackInput(request.body || {})
      );
    });
  });

  app.delete('/api/v1/admin/feedbacks/:id', requirePermission('feedbacks.write'), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.remove(parseFeedbackId(request.params.id));
    });
  });
}

module.exports = {
  registerAdminRoutes
};
