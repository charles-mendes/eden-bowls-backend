require('reflect-metadata');

const { parseEnv } = require('./config/env');
const { createLogger } = require('./core/logger');
const { createApp } = require('./app');
const { createDataSource } = require('./infrastructure/db');
const { AuthRepository } = require('./infrastructure/repositories/auth.repository');
const { BreedsRepository } = require('./infrastructure/repositories/breeds.repository');
const { PriceZonePolicyRepository } = require('./infrastructure/repositories/price-zone-policy.repository');
const { ProductsRepository } = require('./infrastructure/repositories/products.repository');
const { OnboardingAddressAutocompleteRepository } = require('./infrastructure/repositories/onboarding-address-autocomplete.repository');
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
const { OnboardingPetDeleteRepository } = require('./infrastructure/repositories/onboarding-pets-delete.repository');
const { AuthService } = require('./services/auth.service');
const { BreedsService } = require('./services/breeds.service');
const { ProductsService } = require('./services/products.service');
const { OnboardingAddressAutocompleteService } = require('./services/onboarding-address-autocomplete.service');
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
const { OnboardingPetDeleteService } = require('./services/onboarding-pets-delete.service');

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
  const breedsService = new BreedsService(breedsRepository);
  const authService = new AuthService(authRepository, {
    jwt: {
      secret: env.JWT_AUTH_SECRET_KEY,
      algorithm: env.JWT_AUTH_ALGORITHM,
      issuer: env.JWT_AUTH_ISSUER,
      expiresInSeconds: env.JWT_AUTH_EXPIRES_IN_SECONDS
    }
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
  const onboardingAddressAutocompleteRepository = new OnboardingAddressAutocompleteRepository(dataSource, {
    sessionTableName: env.ONBOARDING_SESSIONS_TABLE_NAME || 'wp_hsr_onboarding_sessions'
  });
  const onboardingAddressAutocompleteService = new OnboardingAddressAutocompleteService(onboardingAddressAutocompleteRepository);
  const onboardingPaymentIntentAckRepository = new OnboardingPaymentIntentAckRepository();
  const onboardingPaymentIntentAckService = new OnboardingPaymentIntentAckService(onboardingPaymentIntentAckRepository);
  const onboardingPaymentMethodsRepository = new OnboardingPaymentMethodsRepository();
  const onboardingPaymentMethodsService = new OnboardingPaymentMethodsService(onboardingPaymentMethodsRepository);
  const onboardingPetCreateRepository = new OnboardingPetCreateRepository();
  const onboardingPetCreateService = new OnboardingPetCreateService(onboardingPetCreateRepository);
  const onboardingPetUpdateRepository = new OnboardingPetUpdateRepository();
  const onboardingPetUpdateService = new OnboardingPetUpdateService(onboardingPetUpdateRepository);
  const onboardingPetsRepository = new OnboardingPetsRepository();
  const onboardingPetsService = new OnboardingPetsService(onboardingPetsRepository);
  const onboardingPlanPreviewRepository = new OnboardingPlanPreviewRepository();
  const onboardingPlanPreviewService = new OnboardingPlanPreviewService(onboardingPlanPreviewRepository);
  const onboardingPlanSelectionRepository = new OnboardingPlanSelectionRepository();
  const onboardingPlanSelectionService = new OnboardingPlanSelectionService(onboardingPlanSelectionRepository);
  const onboardingPlanSnapshotRepository = new OnboardingPlanSnapshotRepository();
  const onboardingPlanSnapshotService = new OnboardingPlanSnapshotService(onboardingPlanSnapshotRepository);
  const onboardingRecommendationRepository = new OnboardingRecommendationRepository();
  const onboardingRecommendationService = new OnboardingRecommendationService(onboardingRecommendationRepository);
  const onboardingRecurrenceRepository = new OnboardingRecurrenceRepository();
  const onboardingRecurrenceService = new OnboardingRecurrenceService(onboardingRecurrenceRepository);
  const onboardingSalesTaxQuoteRepository = new OnboardingSalesTaxQuoteRepository();
  const onboardingSalesTaxQuoteService = new OnboardingSalesTaxQuoteService(onboardingSalesTaxQuoteRepository);
  const onboardingShippingSelectRepository = new OnboardingShippingSelectRepository();
  const onboardingShippingSelectService = new OnboardingShippingSelectService(onboardingShippingSelectRepository);
  const onboardingSubscriptionCheckoutRepository = new OnboardingSubscriptionCheckoutRepository();
  const onboardingSubscriptionCheckoutService = new OnboardingSubscriptionCheckoutService(onboardingSubscriptionCheckoutRepository);
  const onboardingSubscriptionPreviewRepository = new OnboardingSubscriptionPreviewRepository();
  const onboardingSubscriptionPreviewService = new OnboardingSubscriptionPreviewService(onboardingSubscriptionPreviewRepository);
  const onboardingZipcodeLookupRepository = new OnboardingZipcodeLookupRepository();
  const onboardingZipcodeLookupService = new OnboardingZipcodeLookupService(onboardingZipcodeLookupRepository);
  const onboardingPetDeleteRepository = new OnboardingPetDeleteRepository();
  const onboardingPetDeleteService = new OnboardingPetDeleteService(onboardingPetDeleteRepository);
  const app = createApp({
    authService,
    breedsService,
    productsService,
    onboardingAddressAutocompleteService,
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
    onboardingPetDeleteService,
    jwt: {
      secret: env.JWT_AUTH_SECRET_KEY,
      algorithm: env.JWT_AUTH_ALGORITHM,
      issuer: env.JWT_AUTH_ISSUER
    },
    corsOrigins: env.CORS_ORIGINS
  });

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, mode: env.MODE }, 'Server started.');
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