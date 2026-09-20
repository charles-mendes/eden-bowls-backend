const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminUsersService } = require('../src/services/admin-users.service');
const { AdminOnboardingService } = require('../src/services/admin-onboarding.service');
const { AdminBillingService } = require('../src/services/admin-billing.service');
const { AdminProductionService } = require('../src/services/admin-production.service');
const { AdminCatalogService } = require('../src/services/admin-catalog.service');
const { FeedbacksService } = require('../src/services/feedbacks.service');
const { PrivacyService } = require('../src/services/privacy.service');
const { UpsShipmentService } = require('../src/services/ups-shipment.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

function brOperator() {
  return {
    userId: '7',
    email: 'ops@edenbowls.com',
    roles: ['operator'],
    markets: ['BR'],
    permissions: [...ROLE_PERMISSIONS.operator, 'market.br']
  };
}

function usUser() {
  return {
    id: '91',
    email: 'us@edenbowls.com',
    status: 'active',
    createdAt: '2026-01-01 00:00:00',
    displayName: 'US Customer',
    storedRoles: '["customer"]',
    storedMarkets: '',
    profileMarket: 'US',
    mustChangePassword: '',
    inviteMailStatus: null,
    inviteExpiresAt: null,
    inviteResendCount: '',
    inviteResendWindowStart: '',
    deletedAt: null,
    profile: { fullName: 'US Customer', phone: null }
  };
}

function appWith(overrides = {}) {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue(brOperator())
    },
    ...overrides
  });
}

describe('admin market record scope', () => {
  const cases = [
    ['GET', '/api/v1/admin/users/91', 'user'],
    ['GET', '/api/v1/admin/onboarding/sessions/91', 'onboarding session'],
    ['GET', '/api/v1/admin/billing/subscriptions/91', 'subscription'],
    ['GET', '/api/v1/admin/billing/invoices/in_us/pdf?account=us', 'invoice PDF'],
    ['PATCH', '/api/v1/admin/production/queue/91', 'production queue patch'],
    ['GET', '/api/v1/admin/catalog/products/91', 'product'],
    ['GET', '/api/v1/admin/feedbacks/91', 'feedback'],
    ['GET', '/api/v1/admin/privacy/requests/91', 'privacy request'],
    ['GET', '/api/v1/admin/shipments/91/label', 'shipment']
  ];

  test.each(cases)('%s %s returns 404 for a US %s', async (method, path) => {
    const adminUsersService = new AdminUsersService({
      usersRepository: {
        findUserById: jest.fn().mockResolvedValue(usUser())
      }
    });
    const adminOnboardingService = new AdminOnboardingService({
      repository: {
        getCheckout: jest.fn().mockResolvedValue({
          userId: '91',
          market: 'US',
          pets: [],
          address: { country: 'US' }
        })
      }
    });
    const usSubscription = {
      id: 91,
      stripeAccount: 'us',
      stripeSubscriptionId: 'sub_us',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: '2026-09-20T08:00:00.000Z',
      profileMarket: 'US',
      address: { country: 'US' }
    };
    const adminBillingService = new AdminBillingService({
      ledgerRepository: {
        findById: jest.fn().mockResolvedValue(usSubscription)
      },
      stripeAccounts: {
        us: { secretKey: 'sk_test_us', ensureClient: () => ({ invoices: { retrieve: jest.fn() } }) },
        br: { secretKey: 'sk_test_br', ensureClient: () => ({ invoices: { retrieve: jest.fn() } }) }
      }
    });
    const adminProductionService = new AdminProductionService({
      ledgerRepository: {
        findById: jest.fn().mockResolvedValue(usSubscription)
      },
      productionRepository: {
        findBySubscriptionAndPeriodEnd: jest.fn(),
        upsert: jest.fn()
      }
    });
    const adminCatalogService = new AdminCatalogService({
      repository: {
        getProduct: jest.fn().mockResolvedValue({ id: '91', planCountry: 'US', variants: [] })
      }
    });
    const feedbacksService = new FeedbacksService({
      findById: jest.fn().mockResolvedValue({ id: 91, country: 'US', name: 'US review' })
    });
    const privacyService = new PrivacyService({
      repository: {
        findRequestById: jest.fn().mockResolvedValue({
          id: 91,
          market: 'US',
          payload: {}
        })
      }
    });
    const upsShipmentService = new UpsShipmentService({
      repository: {
        findById: jest.fn().mockResolvedValue({ id: 91, subscription_id: 91 })
      },
      adminBillingService
    });

    const app = appWith({
      adminUsersService,
      adminOnboardingService,
      adminBillingService,
      adminProductionService,
      adminCatalogService,
      feedbacksService,
      privacyService,
      upsShipmentService
    });

    const req = request(app)[method.toLowerCase()](path).set('Authorization', `Bearer ${tokenFor()}`);
    if (method === 'PATCH') {
      req.send({ status: 'in_production', periodEnd: '2026-09-20T08:00:00.000Z' });
    }
    const response = await req;
    expect(response.status).toBe(404);
  });
});
