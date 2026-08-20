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
      buildShippingUsSettingsEntitySchema()
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
      CreateShippingSettingsTables1700000000010
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