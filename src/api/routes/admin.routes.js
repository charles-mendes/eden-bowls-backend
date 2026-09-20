const { HttpError } = require('../../core/http-error');
const { buildRequireAdminPermission } = require('../middleware/require-admin-permission.middleware');
const { parseNutritionSimulateInput } = require('../validators/admin-nutrition-simulate.validator');
const { parseRolesAssignmentInput } = require('../validators/admin-users-roles.validator');
const { parseShippingSettingsInput, parseShippingTestInput } = require('../validators/admin-shipping.validator');
const { parseCreateCouponInput, parsePromoMappingInput, parseCouponAccount } = require('../validators/admin-coupons.validator');
const { constrainMarketQuery, shouldEnforceMarketScope } = require('../../core/admin-market-scope');
const { parsePageQuery } = require('../validators/admin-pagination');
const { parseAccountStatusInput } = require('../validators/admin-users-status.validator');
const {
  parseProductionQueueQuery,
  parseProductionQueuePatch
} = require('../validators/admin-production.validator');
const {
  parseCreateAccessInput,
  parseUpdateAccessInput,
  parsePasswordChangeInput
} = require('../validators/admin-users-access.validator');
const {
  parseCreateFeedbackInput,
  parseFeedbackActiveInput,
  parseFeedbackId,
  parseFeedbackListQuery,
  parseUpdateFeedbackInput
} = require('../validators/feedbacks.validator');
const { registerAdminPrivacyRoutes } = require('./privacy.routes');

function couponAccountFor(request) {
  const query = { ...(request.query || {}), ...(request.body || {}) };
  if (shouldEnforceMarketScope(request.adminIdentity)) {
    const scoped = constrainMarketQuery(request.adminIdentity, query);
    if (query.account || query.stripe_account) {
      return parseCouponAccount(query);
    }
    if (scoped.stripeAccount) {
      return scoped.stripeAccount;
    }
  }
  return parseCouponAccount(query);
}

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
      if (result && result.binary && result.buffer) {
        response.setHeader('Content-Type', result.contentType || 'application/octet-stream');
        if (result.filename) {
          response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        }
        response.status(200).send(result.buffer);
        return;
      }
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  app.get('/api/v1/admin/me', requirePermission(undefined, { market: 'none' }), async (request, response, next) => {
    await handle(response, next, async () => request.adminIdentity);
  });

  app.post('/api/v1/admin/me/password', requirePermission(undefined, { market: 'none' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.completePasswordChange(
        request.adminIdentity,
        parsePasswordChangeInput(request.body || {})
      );
    });
  });

  app.post('/api/v1/admin/nutrition/simulate', requirePermission('nutrition.simulate', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminNutritionService) {
        throw new HttpError(503, 'Nutrition service is not available.');
      }
      return dependencies.adminNutritionService.simulate(parseNutritionSimulateInput(request.body || {}), request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/shipping/settings', requirePermission('shipping.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminShippingService) {
        throw new HttpError(503, 'Shipping service is not available.');
      }
      return dependencies.adminShippingService.getSettings(request.adminIdentity);
    });
  });

  app.put('/api/v1/admin/shipping/settings', requirePermission('shipping.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminShippingService) {
        throw new HttpError(503, 'Shipping service is not available.');
      }
      return dependencies.adminShippingService.saveSettings(parseShippingSettingsInput(request.body || {}), request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/shipping/test', requirePermission('shipping.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminShippingService) {
        throw new HttpError(503, 'Shipping service is not available.');
      }
      return dependencies.adminShippingService.test(parseShippingTestInput(request.body || {}));
    });
  });

  app.get('/api/v1/admin/billing/subscriptions/:id/shipments', requirePermission('shipping.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.upsShipmentService) {
        throw new HttpError(503, 'UPS shipment service is not available.');
      }
      return dependencies.upsShipmentService.listForSubscription(request.params.id, request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/billing/subscriptions/:id/shipments', requirePermission('shipping.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.upsShipmentService) {
        throw new HttpError(503, 'UPS shipment service is not available.');
      }
      return dependencies.upsShipmentService.createForSubscription({
        subscriptionId: request.params.id,
        invoiceId: request.body && request.body.invoice_id,
        actor: request.adminIdentity
      });
    });
  });

  app.get('/api/v1/admin/shipments/:id/label', requirePermission('shipping.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.upsShipmentService) {
        throw new HttpError(503, 'UPS shipment service is not available.');
      }
      const label = await dependencies.upsShipmentService.getLabel(request.params.id, request.adminIdentity);
      return {
        binary: true,
        buffer: label.buffer,
        contentType: label.contentType,
        filename: label.filename
      };
    });
  });

  app.post('/api/v1/admin/shipments/:id/void', requirePermission('shipping.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.upsShipmentService) {
        throw new HttpError(503, 'UPS shipment service is not available.');
      }
      return dependencies.upsShipmentService.voidShipment(request.params.id, request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/shipments/:id/refresh-tracking', requirePermission('shipping.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.upsShipmentService) {
        throw new HttpError(503, 'UPS shipment service is not available.');
      }
      return dependencies.upsShipmentService.refreshTracking(request.params.id);
    });
  });

  app.get('/api/v1/admin/onboarding/checkouts.csv', requirePermission('onboarding.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return {
        csv: await dependencies.adminOnboardingService.csv(request.query || {}, request.adminIdentity),
        filename: 'onboarding-checkouts.csv'
      };
    });
  });

  app.get('/api/v1/admin/onboarding/checkouts', requirePermission('onboarding.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.list(request.query || {}, parsePageQuery(request.query, { defaultPerPage: 20 }), request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/onboarding/checkouts/:userId', requirePermission('onboarding.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.getByUserId(request.params.userId, request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/onboarding/metrics', requirePermission('onboarding.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.metrics(request.query || {}, request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/onboarding/sessions', requirePermission('onboarding.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.list(request.query || {}, parsePageQuery(request.query, { defaultPerPage: 20 }), request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/onboarding/sessions/:userId', requirePermission('onboarding.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminOnboardingService) {
        throw new HttpError(503, 'Onboarding service is not available.');
      }
      return dependencies.adminOnboardingService.getByUserId(request.params.userId, request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/catalog/products', requirePermission('catalog.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.listProducts(request.query || {}, parsePageQuery(request.query), request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/catalog/products', requirePermission('catalog.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.createProduct(request.body || {});
    });
  });

  app.get('/api/v1/admin/catalog/products/:productId', requirePermission('catalog.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.getProduct(request.params.productId, request.adminIdentity);
    });
  });

  app.patch('/api/v1/admin/catalog/products/:productId', requirePermission('catalog.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.patchProduct(request.params.productId, request.body || {}, request.adminIdentity);
    });
  });

  app.delete('/api/v1/admin/catalog/products/:productId/variations/:variationId', requirePermission('catalog.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.deleteVariation(request.params.productId, request.params.variationId, request.adminIdentity);
    });
  });

  app.delete('/api/v1/admin/catalog/products/:productId', requirePermission('catalog.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.deleteProduct(request.params.productId, request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/catalog/pricing', requirePermission('catalog.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminCatalogService) {
        throw new HttpError(503, 'Catalog service is not available.');
      }
      return dependencies.adminCatalogService.listPricing(request.query || {}, parsePageQuery(request.query), request.adminIdentity);
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
      return dependencies.adminCatalogService.health(request.query || {}, request.adminIdentity);
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

  app.post('/api/v1/admin/catalog/sync', requirePermission('catalog.sync', { market: 'query' }), (request, response, next) => {
    void handleCatalogSync(request, response, next);
  });
  app.post('/api/v1/admin/catalog/sync/:productId', requirePermission('catalog.sync', { market: 'record' }), (request, response, next) => {
    void handleCatalogSync(request, response, next, { productId: request.params.productId });
  });
  app.get('/api/v1/admin/catalog/sync/health', requirePermission('catalog.read', { market: 'query' }), handleCatalogHealth);
  app.get('/api/v1/admin/catalog/sync/status', requirePermission('catalog.read', { market: 'query' }), handleCatalogStatus);

  app.post('/api/v1/billing/catalog/sync', requirePermission('catalog.sync', { market: 'query' }), (request, response, next) => {
    void handleCatalogSync(request, response, next);
  });
  app.post('/api/v1/billing/catalog/sync/:productId', requirePermission('catalog.sync', { market: 'record' }), (request, response, next) => {
    void handleCatalogSync(request, response, next, { productId: request.params.productId });
  });
  app.get('/api/v1/billing/catalog/sync/health', requirePermission('catalog.read', { market: 'query' }), handleCatalogHealth);
  app.get('/api/v1/billing/catalog/sync/status', requirePermission('catalog.read', { market: 'query' }), handleCatalogStatus);

  app.get('/api/v1/admin/production/queue', requirePermission('production.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminProductionService) {
        throw new HttpError(503, 'Production service is not available.');
      }
      return dependencies.adminProductionService.listQueue(
        parseProductionQueueQuery(request.query || {}),
        parsePageQuery(request.query, { defaultPerPage: 20 }),
        request.adminIdentity
      );
    });
  });

  app.patch('/api/v1/admin/production/queue/:id', requirePermission('production.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminProductionService) {
        throw new HttpError(503, 'Production service is not available.');
      }
      return dependencies.adminProductionService.updateStatus(
        request.params.id,
        parseProductionQueuePatch(request.body || {}),
        request.adminIdentity
      );
    });
  });

  app.get('/api/v1/admin/billing/subscriptions', requirePermission('billing.subscribers.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.listSubscriptions(request.query || {}, parsePageQuery(request.query, { defaultPerPage: 20 }), request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/billing/subscriptions/:id', requirePermission('billing.subscribers.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.getSubscription(request.params.id, request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/billing/metrics', requirePermission('billing.subscribers.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.metrics(request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/billing/subscriptions/reconcile', requirePermission('billing.subscribers.sync', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.reconcile(request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/billing/subscriptions/backfill-links', requirePermission('billing.subscribers.sync', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.backfillLinks();
    });
  });

  app.post('/api/v1/admin/billing/subscriptions/:id/sync-invoices', requirePermission('billing.subscribers.sync', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.syncInvoices(request.params.id, request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/billing/invoices/:id/pdf', requirePermission('billing.subscribers.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return { url: await dependencies.adminBillingService.invoicePdfUrl(request.params.id, request.query && request.query.account, request.adminIdentity) };
    });
  });

  app.get('/api/v1/admin/billing/webhooks', requirePermission('billing.subscribers.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminBillingService) {
        throw new HttpError(503, 'Billing service is not available.');
      }
      return dependencies.adminBillingService.listWebhooks(
        parsePageQuery(request.query),
        request.query && (request.query.type || request.query.state),
        request.adminIdentity
      );
    });
  });

  app.get('/api/v1/admin/stripe/first-purchase-promos', requirePermission('billing.coupons.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      return dependencies.stripeCouponService.mappingHealth(couponAccountFor(request));
    });
  });

  app.put('/api/v1/admin/stripe/first-purchase-promos', requirePermission('billing.coupons.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      return dependencies.stripeCouponService.saveMapping(
        parsePromoMappingInput(request.body || {}),
        {},
        couponAccountFor(request)
      );
    });
  });

  app.post('/api/v1/admin/stripe/first-purchase-promos/sync', requirePermission('billing.coupons.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      return dependencies.stripeCouponService.syncFirstPurchasePromos(couponAccountFor(request));
    });
  });

  app.post('/api/v1/admin/stripe/first-purchase-coupons', requirePermission('billing.coupons.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      const payload = parseCreateCouponInput(request.body || {});
      payload.account = couponAccountFor(request);
      return dependencies.stripeCouponService.createFirstPurchaseCoupon(payload);
    });
  });

  app.get('/api/v1/admin/stripe/promotion-codes', requirePermission('billing.coupons.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.stripeCouponService) {
        throw new HttpError(503, 'Coupon service is not available.');
      }
      try {
        return await dependencies.stripeCouponService.listRecentPromotionCodes(25, couponAccountFor(request));
      } catch (error) {
        return {
          success: false,
          message: error.message || 'Unable to list Stripe promotion codes.'
        };
      }
    });
  });

  app.get('/api/v1/admin/users', requirePermission('users.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.list(request.query || {}, parsePageQuery(request.query), request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/users', requirePermission('users.access.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.createAccess(
        parseCreateAccessInput(request.body || {}),
        request.adminIdentity
      );
    });
  });

  app.get('/api/v1/admin/users/roles', requirePermission('users.roles.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.listStaff(request.query || {}, parsePageQuery(request.query, { defaultPerPage: 50 }));
    });
  });

  app.get('/api/v1/admin/users/:userId', requirePermission('users.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.getById(request.params.userId, request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/users/:userId/roles', requirePermission('users.roles.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.getRoles(request.params.userId);
    });
  });

  app.put('/api/v1/admin/users/:userId/roles', requirePermission('users.roles.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      const assignment = parseRolesAssignmentInput(request.body || {});
      return dependencies.adminUsersService.updateRoles(
        request.params.userId,
        assignment.roles,
        request.adminIdentity,
        { markets: assignment.markets }
      );
    });
  });

  app.patch('/api/v1/admin/users/:userId/delivery', requirePermission('users.delivery.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.updateDelivery(request.params.userId, request.body || {}, request.adminIdentity);
    });
  });

  app.patch('/api/v1/admin/users/:userId/delivery-instructions', requirePermission('users.delivery.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.updateDeliveryInstructions(
        request.params.userId,
        request.body && request.body.deliveryInstructions,
        request.adminIdentity
      );
    });
  });

  app.patch('/api/v1/admin/users/:userId/status', requirePermission('users.status.write', { market: 'record' }), async (request, response, next) => {
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

  app.patch('/api/v1/admin/users/:userId', requirePermission('users.access.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.updateAccess(
        request.params.userId,
        parseUpdateAccessInput(request.body || {}),
        request.adminIdentity
      );
    });
  });

  app.post('/api/v1/admin/users/:userId/invite', requirePermission('users.access.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.resendInvite(request.params.userId, request.adminIdentity);
    });
  });

  app.delete('/api/v1/admin/users/:userId', requirePermission('users.access.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.adminUsersService) {
        throw new HttpError(503, 'Users service is not available.');
      }
      return dependencies.adminUsersService.softDelete(request.params.userId, request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/feedbacks', requirePermission('feedbacks.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.list(parseFeedbackListQuery(request.query || {}), request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/feedbacks', requirePermission('feedbacks.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.create(parseCreateFeedbackInput(request.body || {}));
    });
  });

  app.get('/api/v1/admin/feedbacks/:id', requirePermission('feedbacks.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.getById(parseFeedbackId(request.params.id), request.adminIdentity);
    });
  });

  app.patch('/api/v1/admin/feedbacks/:id/active', requirePermission('feedbacks.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.setActive(
        parseFeedbackId(request.params.id),
        parseFeedbackActiveInput(request.body || {}),
        request.adminIdentity
      );
    });
  });

  app.patch('/api/v1/admin/feedbacks/:id', requirePermission('feedbacks.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.update(
        parseFeedbackId(request.params.id),
        parseUpdateFeedbackInput(request.body || {}),
        request.adminIdentity
      );
    });
  });

  app.delete('/api/v1/admin/feedbacks/:id', requirePermission('feedbacks.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      if (!dependencies.feedbacksService) {
        throw new HttpError(503, 'Feedbacks service is not available.');
      }
      return dependencies.feedbacksService.remove(parseFeedbackId(request.params.id), request.adminIdentity);
    });
  });

  registerAdminPrivacyRoutes(app, dependencies, { requirePermission, handle });
}

module.exports = {
  registerAdminRoutes
};
