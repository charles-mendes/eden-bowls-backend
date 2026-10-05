const { DataSource } = require('typeorm');
const { buildBreedEntitySchema } = require('./entities/breed.entity');
const { buildPriceZonePolicyEntitySchema } = require('./entities/price-zone-policy.entity');
const { buildWpUserEntitySchema } = require('./entities/wp-user.entity');
const { buildWpUserMetaEntitySchema } = require('./entities/wp-user-meta.entity');
const { buildOnboardingPetEntitySchema } = require('./entities/onboarding-pet.entity');
const { buildOnboardingUserStateEntitySchema } = require('./entities/onboarding-user-state.entity');
const { buildAuthRefreshTokenEntitySchema } = require('./entities/auth-refresh-token.entity');
const { buildOnboardingQuoteEntitySchema } = require('./entities/onboarding-quote.entity');
const {
  buildStripeFirstPurchasePromoEntitySchema,
  buildStripeFirstPurchasePromoMetricEntitySchema
} = require('./entities/stripe-first-purchase-promo.entity');
const { buildStripeSubscriptionEntitySchema } = require('./entities/stripe-subscription.entity');
const { buildStripeWebhookEventEntitySchema } = require('./entities/stripe-webhook-event.entity');
const {
  buildShippingBrSettingsEntitySchema,
  buildShippingUsSettingsEntitySchema
} = require('./entities/shipping-settings.entity');
const { buildFeedbackEntitySchema } = require('./entities/feedback.entity');
const { CreateBreedsTable1700000000000 } = require('./migrations/1700000000000-create-breeds-table');
const { CreatePriceZonePolicyTable1700000000001 } = require('./migrations/1700000000001-create-price-zone-policy-table');
const { CreateProductsCatalogTables1700000000002 } = require('./migrations/1700000000002-create-products-catalog-tables');
const { CreateAuthUserTables1700000000003 } = require('./migrations/1700000000003-create-auth-user-tables');
const { CreateUserOwnedOnboardingTables1700000000004 } = require('./migrations/1700000000004-create-user-owned-onboarding-tables');
const { CreateAuthRefreshTokensTable1700000000005 } = require('./migrations/1700000000005-create-auth-refresh-tokens-table');
const { CreateOnboardingQuotesTable1700000000006 } = require('./migrations/1700000000006-create-onboarding-quotes-table');
const { SeedCurrentAppFlavorsCatalog1700000000007 } = require('./migrations/1700000000007-seed-current-app-flavors-catalog');
const { CreateStripeFirstPurchasePromosTable1700000000008 } = require('./migrations/1700000000008-create-stripe-first-purchase-promos-table');
const { CreateStripeSubscriptionLedgerTables1700000000009 } = require('./migrations/1700000000009-create-stripe-subscription-ledger-tables');
const { CreateShippingSettingsTables1700000000010 } = require('./migrations/1700000000010-create-shipping-settings-tables');
const { CreateFeedbacksTable1700000000011 } = require('./migrations/1700000000011-create-feedbacks-table');
const { AddFeedbackPlaceAndSeed1700000000012 } = require('./migrations/1700000000012-add-feedback-place-and-seed');
const { ExtendUsShippingAndCreateUpsShipments1700000000013 } = require('./migrations/1700000000013-extend-us-shipping-and-create-ups-shipments');
const { SplitStripeAccounts1700000000014 } = require('./migrations/1700000000014-split-stripe-accounts');
const { CreatePrivacyTables1700000000015 } = require('./migrations/1700000000015-create-privacy-tables');
const { CreateAdminAuditEvents1700000000016 } = require('./migrations/1700000000016-create-admin-audit-events');
const { CreateSubscriptionMailClaims1700000000017 } = require('./migrations/1700000000017-create-subscription-mail-claims');
const { CreateSubscriptionProductionCycles1700000000018 } = require('./migrations/1700000000018-create-subscription-production-cycles');
const { AddOnboardingUserStateMarket1700000000019 } = require('./migrations/1700000000019-add-onboarding-user-state-market');
const { AddBackgroundJobSchema1700000000020 } = require('./migrations/1700000000020-add-background-job-schema');
const { CreateDeliveryClosedDays1700000000021 } = require('./migrations/1700000000021-create-delivery-closed-days');
const { AddLedgerChargedDeliveries1700000000022 } = require('./migrations/1700000000022-add-ledger-charged-deliveries');
const { AddLedgerPendingDeliveryChanges1700000000023 } = require('./migrations/1700000000023-add-ledger-pending-delivery-changes');
const { CreateSubscriptionChargedInvoices1700000000024 } = require('./migrations/1700000000024-create-subscription-charged-invoices');
const { AddProductionCyclePayment1700000000025 } = require('./migrations/1700000000025-add-production-cycle-payment');
const { SeedUs2027DeliveryClosedDays1700000000026 } = require('./migrations/1700000000026-seed-us-2027-delivery-closed-days');
const { AddDeliveryClosedDayType1700000000027 } = require('./migrations/1700000000027-add-delivery-closed-day-type');
const { CreateDeliveryCalendarStripeSyncs1700000000028 } = require('./migrations/1700000000028-create-delivery-calendar-stripe-syncs');
const { CreateCustomerInvoices1700000000029 } = require('./migrations/1700000000029-create-customer-invoices');
const { buildBackgroundJobCursorEntitySchema } = require('./entities/background-job-cursor.entity');
const { buildDeliveryClosedDayEntitySchema } = require('./entities/delivery-closed-day.entity');
const { buildPrivacyConsentEntitySchema } = require('./entities/privacy-consent.entity');
const { buildPrivacyRequestEntitySchema } = require('./entities/privacy-request.entity');
const { buildAdminAuditEventEntitySchema } = require('./entities/admin-audit-event.entity');
const { buildSubscriptionMailClaimEntitySchema } = require('./entities/subscription-mail-claim.entity');
const { buildSubscriptionProductionCycleEntitySchema } = require('./entities/subscription-production-cycle.entity');

function buildDataSourceOptions(env) {
  return {
    type: 'mysql',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: [
      buildBreedEntitySchema(env.BREEDS_TABLE_NAME),
      buildPriceZonePolicyEntitySchema(env.PRICE_ZONE_POLICY_TABLE_NAME),
      buildWpUserEntitySchema(env.WP_USERS_TABLE_NAME),
      buildWpUserMetaEntitySchema(env.WP_USERMETA_TABLE_NAME),
      buildOnboardingPetEntitySchema(),
      buildOnboardingUserStateEntitySchema(),
      buildAuthRefreshTokenEntitySchema(),
      buildOnboardingQuoteEntitySchema(),
      buildStripeFirstPurchasePromoEntitySchema(),
      buildStripeFirstPurchasePromoMetricEntitySchema(),
      buildStripeSubscriptionEntitySchema(),
      buildStripeWebhookEventEntitySchema(),
      buildShippingBrSettingsEntitySchema(),
      buildShippingUsSettingsEntitySchema(),
      buildFeedbackEntitySchema(),
      buildPrivacyConsentEntitySchema(),
      buildPrivacyRequestEntitySchema(),
      buildAdminAuditEventEntitySchema(),
      buildSubscriptionMailClaimEntitySchema(),
      buildSubscriptionProductionCycleEntitySchema(),
      buildBackgroundJobCursorEntitySchema(),
      buildDeliveryClosedDayEntitySchema()
    ],
    migrations: [
      CreateBreedsTable1700000000000,
      CreatePriceZonePolicyTable1700000000001,
      CreateProductsCatalogTables1700000000002,
      CreateAuthUserTables1700000000003,
      CreateUserOwnedOnboardingTables1700000000004,
      CreateAuthRefreshTokensTable1700000000005,
      CreateOnboardingQuotesTable1700000000006,
      SeedCurrentAppFlavorsCatalog1700000000007,
      CreateStripeFirstPurchasePromosTable1700000000008,
      CreateStripeSubscriptionLedgerTables1700000000009,
      CreateShippingSettingsTables1700000000010,
      CreateFeedbacksTable1700000000011,
      AddFeedbackPlaceAndSeed1700000000012,
      ExtendUsShippingAndCreateUpsShipments1700000000013,
      SplitStripeAccounts1700000000014,
      CreatePrivacyTables1700000000015,
      CreateAdminAuditEvents1700000000016,
      CreateSubscriptionMailClaims1700000000017,
      CreateSubscriptionProductionCycles1700000000018,
      AddOnboardingUserStateMarket1700000000019,
      AddBackgroundJobSchema1700000000020,
      CreateDeliveryClosedDays1700000000021,
      AddLedgerChargedDeliveries1700000000022,
      AddLedgerPendingDeliveryChanges1700000000023,
      CreateSubscriptionChargedInvoices1700000000024,
      AddProductionCyclePayment1700000000025,
      SeedUs2027DeliveryClosedDays1700000000026,
      AddDeliveryClosedDayType1700000000027,
      CreateDeliveryCalendarStripeSyncs1700000000028,
      CreateCustomerInvoices1700000000029
    ],
    synchronize: false,
    logging: false,
    charset: 'utf8mb4',
    timezone: 'Z'
  };
}

function createDataSource(env) {
  return new DataSource(buildDataSourceOptions(env));
}

module.exports = {
  buildDataSourceOptions,
  createDataSource
};