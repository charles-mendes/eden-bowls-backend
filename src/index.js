require('reflect-metadata');

const { parseEnv } = require('./config/env');
const { createLogger } = require('./core/logger');
const { createApp } = require('./app');
const { createDataSource } = require('./infrastructure/db');
const { AuthRepository } = require('./infrastructure/repositories/auth.repository');
const { AuthRefreshTokenRepository } = require('./infrastructure/repositories/auth-refresh-token.repository');
const { BreedsRepository } = require('./infrastructure/repositories/breeds.repository');
const { PriceZonePolicyRepository } = require('./infrastructure/repositories/price-zone-policy.repository');
const { ProductsRepository } = require('./infrastructure/repositories/products.repository');
const { OnboardingAddressAutocompleteRepository } = require('./infrastructure/repositories/onboarding-address-autocomplete.repository');
const { OnboardingDiscountEligibilityRepository } = require('./infrastructure/repositories/onboarding-discount-eligibility.repository');
const { OnboardingPaymentIntentAckRepository } = require('./infrastructure/repositories/onboarding-payment-intent-ack.repository');
const { OnboardingPaymentMethodsRepository } = require('./infrastructure/repositories/onboarding-payment-methods.repository');
const { OnboardingPetCreateRepository } = require('./infrastructure/repositories/onboarding-pets-create.repository');
const { OnboardingPetUpdateRepository } = require('./infrastructure/repositories/onboarding-pets-update.repository');
const { OnboardingPetsRepository } = require('./infrastructure/repositories/onboarding-pets.repository');
const { OnboardingPlanPreviewRepository } = require('./infrastructure/repositories/onboarding-plan-preview.repository');
const { OnboardingPlanSelectionRepository } = require('./infrastructure/repositories/onboarding-plan-selection.repository');
const { OnboardingPlanSnapshotRepository } = require('./infrastructure/repositories/onboarding-plan-snapshot.repository');
const { OnboardingRecommendationRepository } = require('./infrastructure/repositories/onboarding-recommendation.repository');
const { OnboardingRecurrenceRepository } = require('./infrastructure/repositories/onboarding-recurrence.repository');
const { OnboardingSalesTaxQuoteRepository } = require('./infrastructure/repositories/onboarding-sales-tax-quote.repository');
const { OnboardingShippingSelectRepository } = require('./infrastructure/repositories/onboarding-shipping-select.repository');
const { OnboardingSubscriptionCheckoutRepository } = require('./infrastructure/repositories/onboarding-subscription-checkout.repository');
const { OnboardingSubscriptionPreviewRepository } = require('./infrastructure/repositories/onboarding-subscription-preview.repository');
const { OnboardingZipcodeLookupRepository } = require('./infrastructure/repositories/onboarding-zipcode-lookup.repository');
const { OnboardingZipcodeRepository } = require('./infrastructure/repositories/onboarding-zipcode.repository');
const { TtlCache } = require('./infrastructure/cache/ttl-cache');
const { ViaCepClient } = require('./infrastructure/geo/via-cep-client');
const { ZippopotamClient } = require('./infrastructure/geo/zippopotam-client');
const { NominatimClient } = require('./infrastructure/geo/nominatim-client');
const { OsrmClient } = require('./infrastructure/geo/osrm-client');
const { loadShippingSettings } = require('./infrastructure/shipping/shipping-settings');
const { StripeBillingClient } = require('./infrastructure/stripe/stripe-billing-client');
const { StripeCustomerStore } = require('./infrastructure/stripe/stripe-customer-store');
const { SubscriptionsActionsRepository } = require('./infrastructure/repositories/subscriptions-actions.repository');
const { SubscriptionsDetailRepository } = require('./infrastructure/repositories/subscriptions-detail.repository');
const { SubscriptionsEditCommitRepository } = require('./infrastructure/repositories/subscriptions-edit-commit.repository');
const { SubscriptionsEditPreviewRepository } = require('./infrastructure/repositories/subscriptions-edit-preview.repository');
const { SubscriptionsRepository } = require('./infrastructure/repositories/subscriptions.repository');
const { SubscriptionLedgerRepository } = require('./infrastructure/repositories/subscription-ledger.repository');
const { StripeWebhookEventsRepository } = require('./infrastructure/repositories/stripe-webhook-events.repository');
const { OnboardingPetDeleteRepository } = require('./infrastructure/repositories/onboarding-pets-delete.repository');
const { AuthService } = require('./services/auth.service');
const { createOtpMailer } = require('./infrastructure/mailers/otp-mailer');
const { BreedsService } = require('./services/breeds.service');
const { ProductsService } = require('./services/products.service');
const { OnboardingAddressAutocompleteService } = require('./services/onboarding-address-autocomplete.service');
const { OnboardingDiscountEligibilityService } = require('./services/onboarding-discount-eligibility.service');
const { OnboardingPaymentIntentAckService } = require('./services/onboarding-payment-intent-ack.service');
const { OnboardingPaymentMethodsService } = require('./services/onboarding-payment-methods.service');
const { OnboardingPetCreateService } = require('./services/onboarding-pets-create.service');
const { OnboardingPetUpdateService } = require('./services/onboarding-pets-update.service');
const { OnboardingPetsService } = require('./services/onboarding-pets.service');
const { OnboardingPlanPreviewService } = require('./services/onboarding-plan-preview.service');
const { OnboardingPlanSelectionService } = require('./services/onboarding-plan-selection.service');
const { OnboardingPlanSnapshotService } = require('./services/onboarding-plan-snapshot.service');
const { OnboardingRecommendationService } = require('./services/onboarding-recommendation.service');
const { OnboardingRecurrenceService } = require('./services/onboarding-recurrence.service');
const { OnboardingSalesTaxQuoteService } = require('./services/onboarding-sales-tax-quote.service');
const { OnboardingShippingSelectService } = require('./services/onboarding-shipping-select.service');
const { OnboardingSubscriptionCheckoutService } = require('./services/onboarding-subscription-checkout.service');
const { OnboardingSubscriptionPreviewService } = require('./services/onboarding-subscription-preview.service');
const { OnboardingZipcodeLookupService } = require('./services/onboarding-zipcode-lookup.service');
const { OnboardingZipcodeService } = require('./services/onboarding-zipcode.service');
const { ShippingService } = require('./services/shipping.service');
const { SubscriptionsActionsService } = require('./services/subscriptions-actions.service');
const { SubscriptionsDetailService } = require('./services/subscriptions-detail.service');
const { SubscriptionsEditCommitService } = require('./services/subscriptions-edit-commit.service');
const { SubscriptionsEditPreviewService } = require('./services/subscriptions-edit-preview.service');
const { SubscriptionsService } = require('./services/subscriptions.service');
const { StripeWebhookService } = require('./services/stripe-webhook.service');
const { OnboardingPetDeleteService } = require('./services/onboarding-pets-delete.service');
const { OnboardingPetsSyncService } = require('./services/onboarding-pets-sync.service');
const { OnboardingQuotesRepository } = require('./infrastructure/repositories/onboarding-quotes.repository');
const { StripeFirstPurchasePromosRepository } = require('./infrastructure/repositories/stripe-first-purchase-promos.repository');
const { StripeCouponService } = require('./services/stripe-coupon.service');
const { MaxMindCountryReader } = require('./infrastructure/geo/maxmind-country-reader');
const { GeoService } = require('./services/geo.service');

async function bootstrap() {
  const env = parseEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });
  const dataSource = createDataSource(env);

  await dataSource.initialize();
  await dataSource.runMigrations();

  const breedsRepository = new BreedsRepository(dataSource, {
    tableName: env.BREEDS_TABLE_NAME
  });
  const authRepository = new AuthRepository(dataSource, {
    usersTableName: env.WP_USERS_TABLE_NAME,
    usermetaTableName: env.WP_USERMETA_TABLE_NAME
  });
  const authRefreshTokenRepository = new AuthRefreshTokenRepository(dataSource);
  const breedsService = new BreedsService(breedsRepository);
  const authService = new AuthService(authRepository, {
    jwt: {
      secret: env.JWT_AUTH_SECRET_KEY,
      algorithm: env.JWT_AUTH_ALGORITHM,
      issuer: env.JWT_AUTH_ISSUER,
      expiresInSeconds: env.JWT_AUTH_EXPIRES_IN_SECONDS
    },
    refreshTokenRepository: authRefreshTokenRepository,
    refreshTokenTtlSeconds: env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    otpTtlSeconds: env.AUTH_OTP_TTL_SECONDS,
    otpMaxAttempts: env.AUTH_OTP_MAX_ATTEMPTS,
    otpPepper: env.AUTH_OTP_PEPPER,
    otpResendMaxAttempts: env.AUTH_OTP_RESEND_MAX_ATTEMPTS,
    otpResendWindowSeconds: env.AUTH_OTP_RESEND_WINDOW_SECONDS,
    otpMailer: createOtpMailer({
      logger,
      nodeEnv: env.NODE_ENV,
      smtp: {
        host: env.AUTH_SMTP_HOST,
        port: env.AUTH_SMTP_PORT,
        user: env.AUTH_SMTP_USER,
        pass: env.AUTH_SMTP_PASS,
        encryption: env.AUTH_SMTP_ENCRYPTION,
        auth: env.AUTH_SMTP_AUTH,
        from: env.AUTH_MAIL_FROM,
        fromName: env.AUTH_MAIL_FROM_NAME
      }
    })
  });
  const priceZonePolicyRepository = new PriceZonePolicyRepository(dataSource, {
    tableName: env.PRICE_ZONE_POLICY_TABLE_NAME
  });
  const productsRepository = new ProductsRepository(dataSource, {
    postsTableName: env.WP_POSTS_TABLE_NAME,
    postmetaTableName: env.WP_POSTMETA_TABLE_NAME,
    termsTableName: env.WP_TERMS_TABLE_NAME,
    termTaxonomyTableName: env.WP_TERM_TAXONOMY_TABLE_NAME,
    termRelationshipsTableName: env.WP_TERM_RELATIONSHIPS_TABLE_NAME,
    priceZonePolicyRepository
  });
  const productsService = new ProductsService(productsRepository);
  const geoCache = new TtlCache();
  const viaCepClient = new ViaCepClient({ cache: geoCache });
  const zippopotamClient = new ZippopotamClient();
  const nominatimClient = new NominatimClient({
    cache: geoCache,
    userAgent: env.NOMINATIM_USER_AGENT
  });
  const osrmClient = new OsrmClient({ cache: geoCache });
  const shippingService = new ShippingService({
    settings: loadShippingSettings({ env }),
    viaCepClient,
    nominatimClient,
    osrmClient
  });
  const stripeBilling = new StripeBillingClient({
    secretKey: env.STRIPE_SECRET_KEY,
    apiVersion: env.STRIPE_API_VERSION,
    maxNetworkRetries: env.STRIPE_MAX_RETRIES,
    automaticTaxEnabled: env.STRIPE_US_AUTOMATIC_TAX,
    shippingProductId: env.STRIPE_SHIPPING_PRODUCT_ID
  });
  const stripeCustomerStore = new StripeCustomerStore(dataSource, {
    usermetaTableName: env.WP_USERMETA_TABLE_NAME
  });
  const onboardingAddressAutocompleteRepository = new OnboardingAddressAutocompleteRepository({
    nominatimClient
  });
  const onboardingAddressAutocompleteService = new OnboardingAddressAutocompleteService(onboardingAddressAutocompleteRepository);
  const stripeFirstPurchasePromosRepository = new StripeFirstPurchasePromosRepository(dataSource);
  const stripeCouponService = new StripeCouponService(stripeFirstPurchasePromosRepository, {
    envMapping: {
      1: env.STRIPE_FIRST_PURCHASE_PROMO_1M,
      3: env.STRIPE_FIRST_PURCHASE_PROMO_3M,
      6: env.STRIPE_FIRST_PURCHASE_PROMO_6M
    }
  });
  const onboardingDiscountEligibilityRepository = new OnboardingDiscountEligibilityRepository(dataSource, {
    postsTableName: env.WP_POSTS_TABLE_NAME,
    postmetaTableName: env.WP_POSTMETA_TABLE_NAME,
    usersTableName: env.WP_USERS_TABLE_NAME,
    subscriptionsTableName: env.WP_HSR_STRIPE_SUBSCRIPTIONS_TABLE_NAME
  });
  const onboardingDiscountEligibilityService = new OnboardingDiscountEligibilityService(onboardingDiscountEligibilityRepository);
  const onboardingPaymentIntentAckRepository = new OnboardingPaymentIntentAckRepository(dataSource);
  const onboardingPaymentIntentAckService = new OnboardingPaymentIntentAckService(onboardingPaymentIntentAckRepository, { authService });
  const onboardingPaymentMethodsRepository = new OnboardingPaymentMethodsRepository({
    customerStore: stripeCustomerStore,
    stripeBilling
  });
  const onboardingPaymentMethodsService = new OnboardingPaymentMethodsService(onboardingPaymentMethodsRepository);
  const onboardingPetCreateRepository = new OnboardingPetCreateRepository(dataSource);
  const onboardingPetCreateService = new OnboardingPetCreateService(onboardingPetCreateRepository);
  const onboardingPetUpdateRepository = new OnboardingPetUpdateRepository(dataSource);
  const onboardingPetUpdateService = new OnboardingPetUpdateService(onboardingPetUpdateRepository);
  const onboardingPetsRepository = new OnboardingPetsRepository(dataSource);
  const onboardingPetsService = new OnboardingPetsService(onboardingPetsRepository);
  const onboardingRecommendationRepository = new OnboardingRecommendationRepository(onboardingPetsRepository);
  const onboardingRecommendationService = new OnboardingRecommendationService(onboardingRecommendationRepository);
  const onboardingPlanPreviewRepository = new OnboardingPlanPreviewRepository({
    recommendationRepository: onboardingRecommendationRepository,
    productsRepository
  });
  const onboardingQuotesRepository = new OnboardingQuotesRepository(dataSource);
  const onboardingPlanPreviewService = new OnboardingPlanPreviewService(onboardingPlanPreviewRepository, {
    quotesRepository: onboardingQuotesRepository
  });
  const onboardingPlanSelectionRepository = new OnboardingPlanSelectionRepository(dataSource);
  const onboardingPlanSelectionService = new OnboardingPlanSelectionService(onboardingPlanSelectionRepository, {
    planPreviewRepository: onboardingPlanPreviewRepository
  });
  const onboardingPlanSnapshotRepository = new OnboardingPlanSnapshotRepository({
    recommendationRepository: onboardingRecommendationRepository
  });
  const onboardingPlanSnapshotService = new OnboardingPlanSnapshotService(onboardingPlanSnapshotRepository);
  const onboardingRecurrenceRepository = new OnboardingRecurrenceRepository(dataSource);
  const onboardingRecurrenceService = new OnboardingRecurrenceService(onboardingRecurrenceRepository);
  const onboardingSubscriptionPreviewRepository = new OnboardingSubscriptionPreviewRepository(dataSource, {
    stripeBilling
  });
  const onboardingSubscriptionPreviewService = new OnboardingSubscriptionPreviewService(onboardingSubscriptionPreviewRepository);
  const onboardingSalesTaxQuoteRepository = new OnboardingSalesTaxQuoteRepository(dataSource);
  const onboardingSalesTaxQuoteService = new OnboardingSalesTaxQuoteService(onboardingSalesTaxQuoteRepository, {
    automaticTaxEnabled: env.STRIPE_US_AUTOMATIC_TAX,
    previewRepository: onboardingSubscriptionPreviewRepository
  });
  const onboardingShippingSelectRepository = new OnboardingShippingSelectRepository(dataSource);
  const onboardingShippingSelectService = new OnboardingShippingSelectService(onboardingShippingSelectRepository);
  const onboardingSubscriptionCheckoutRepository = new OnboardingSubscriptionCheckoutRepository(dataSource);
  const subscriptionLedgerRepository = new SubscriptionLedgerRepository(dataSource);
  const stripeWebhookEventsRepository = new StripeWebhookEventsRepository(dataSource);
  const stripeWebhookService = new StripeWebhookService({
    stripeBilling,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    eventsRepository: stripeWebhookEventsRepository,
    ledgerRepository: subscriptionLedgerRepository,
    customerStore: stripeCustomerStore,
    shippingProductId: env.STRIPE_SHIPPING_PRODUCT_ID,
    logger
  });
  const onboardingSubscriptionCheckoutService = new OnboardingSubscriptionCheckoutService(onboardingSubscriptionCheckoutRepository, {
    authService,
    discountEligibilityRepository: onboardingDiscountEligibilityRepository,
    stripeCouponService,
    stripeBilling,
    customerStore: stripeCustomerStore,
    ledgerRepository: subscriptionLedgerRepository,
    planPreviewRepository: onboardingPlanPreviewRepository
  });
  const onboardingZipcodeLookupRepository = new OnboardingZipcodeLookupRepository({
    viaCepClient,
    zippopotamClient
  });
  const onboardingZipcodeLookupService = new OnboardingZipcodeLookupService(onboardingZipcodeLookupRepository);
  const onboardingZipcodeRepository = new OnboardingZipcodeRepository(dataSource);
  const onboardingZipcodeService = new OnboardingZipcodeService(onboardingZipcodeRepository);
  const subscriptionsActionsRepository = new SubscriptionsActionsRepository({
    ledgerRepository: subscriptionLedgerRepository,
    stripeBilling
  });
  const subscriptionsActionsService = new SubscriptionsActionsService(subscriptionsActionsRepository, { authService });
  const subscriptionsDetailRepository = new SubscriptionsDetailRepository({
    ledgerRepository: subscriptionLedgerRepository,
    stripeBilling
  });
  const subscriptionsDetailService = new SubscriptionsDetailService(subscriptionsDetailRepository);
  const subscriptionsEditPreviewRepository = new SubscriptionsEditPreviewRepository({
    ledgerRepository: subscriptionLedgerRepository,
    stripeBilling,
    planPreviewRepository: onboardingPlanPreviewRepository,
    resolveSubscriptionItems: (planSelection) => onboardingSubscriptionCheckoutRepository.resolveSubscriptionItems(planSelection)
  });
  const subscriptionsEditPreviewService = new SubscriptionsEditPreviewService(subscriptionsEditPreviewRepository, {
    ledgerRepository: subscriptionLedgerRepository
  });
  const subscriptionsEditCommitRepository = new SubscriptionsEditCommitRepository({
    ledgerRepository: subscriptionLedgerRepository,
    stripeBilling,
    planPreviewRepository: onboardingPlanPreviewRepository,
    resolveSubscriptionItems: (planSelection) => onboardingSubscriptionCheckoutRepository.resolveSubscriptionItems(planSelection)
  });
  const subscriptionsEditCommitService = new SubscriptionsEditCommitService(subscriptionsEditCommitRepository, {
    authService,
    ledgerRepository: subscriptionLedgerRepository
  });
  const subscriptionsRepository = new SubscriptionsRepository({
    ledgerRepository: subscriptionLedgerRepository
  });
  const subscriptionsService = new SubscriptionsService(subscriptionsRepository);
  const onboardingPetDeleteRepository = new OnboardingPetDeleteRepository(dataSource);
  const onboardingPetDeleteService = new OnboardingPetDeleteService(onboardingPetDeleteRepository);
  const onboardingPetsSyncService = new OnboardingPetsSyncService(onboardingPetCreateRepository);
  const countryReader = new MaxMindCountryReader({ dbPath: env.GEO_MAXMIND_DB_PATH });
  await countryReader.open();
  if (!countryReader.isOpen()) {
    logger.warn({ dbPath: env.GEO_MAXMIND_DB_PATH }, 'GeoLite2 country database is not available; geo country will be UNKNOWN.');
  }
  const geoService = new GeoService({
    countryReader,
    trustProxy: env.GEO_TRUST_PROXY_HEADERS
  });
  const app = createApp({
    authService,
    authCookie: {
      name: env.AUTH_REFRESH_COOKIE_NAME,
      path: env.AUTH_REFRESH_COOKIE_PATH,
      domain: env.AUTH_REFRESH_COOKIE_DOMAIN,
      sameSite: env.AUTH_REFRESH_COOKIE_SAME_SITE,
      secure: env.AUTH_REFRESH_COOKIE_SECURE,
      maxAgeSeconds: env.AUTH_REFRESH_TOKEN_TTL_SECONDS
    },
    breedsService,
    productsService,
    onboardingAddressAutocompleteService,
    onboardingDiscountEligibilityService,
    onboardingPaymentIntentAckService,
    onboardingPaymentMethodsService,
    onboardingPetCreateService,
    onboardingPetUpdateService,
    onboardingPetsService,
    onboardingPlanPreviewService,
    onboardingPlanSelectionService,
    onboardingPlanSnapshotService,
    onboardingRecommendationService,
    onboardingRecurrenceService,
    onboardingSalesTaxQuoteService,
    onboardingShippingSelectService,
    onboardingSubscriptionCheckoutService,
    onboardingSubscriptionPreviewService,
    onboardingZipcodeLookupService,
    onboardingZipcodeService,
    shippingService,
    subscriptionsActionsService,
    subscriptionsDetailService,
    subscriptionsEditPreviewService,
    subscriptionsEditCommitService,
    subscriptionsService,
    stripeWebhookService,
    onboardingPetDeleteService,
    onboardingPetsSyncService,
    geoService,
    jwt: {
      secret: env.JWT_AUTH_SECRET_KEY,
      algorithm: env.JWT_AUTH_ALGORITHM,
      issuer: env.JWT_AUTH_ISSUER
    },
    corsOrigins: env.CORS_ORIGINS
  });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, mode: env.MODE }, 'Server started.');
  });

  server.on('error', (error) => {
    logger.error(error, 'HTTP server failed to listen.');
    process.exit(1);
  });
}

if (require.main === module) {
  bootstrap().catch((error) => {
    const logger = createLogger({ nodeEnv: process.env.NODE_ENV });
    logger.error(error, 'Failed to start application.');
    process.exit(1);
  });
}

module.exports = {
  bootstrap
};