const { ShippingQuoteSigner } = require('../core/shipping-quote-token');
const { ShippingService } = require('../services/shipping.service');
const { CustomerDeliveriesService } = require('../services/customer-deliveries.service');
const { SubscriptionDeliveriesRepository } = require('../infrastructure/repositories/subscription-deliveries.repository');

// Every consumer of a signed quote must share this one signer, or valid quotes are refused as unverified.
function createShippingQuoteServices({
  env,
  logger,
  shippingSettings,
  viaCepClient,
  nominatimClient,
  osrmClient,
  upsClient,
  deliveryCalendar,
  stripeAccounts,
  ledgerRepository,
  productionRepository
}) {
  const shippingQuoteSigner = new ShippingQuoteSigner({ secret: env.SHIPPING_QUOTE_SECRET });
  const shippingService = new ShippingService({
    settings: shippingSettings,
    viaCepClient,
    nominatimClient,
    osrmClient,
    upsClient,
    quoteSigner: shippingQuoteSigner,
    production: env.EDEN_RUNTIME === 'production',
    fixedTransitDays: env.SHIPPING_US_FIXED_TRANSIT_DAYS
  });
  shippingService.reportQuoteModeAtStartup(logger);
  const subscriptionDeliveries = new SubscriptionDeliveriesRepository({
    ledgerRepository,
    productionRepository,
    stripeAccounts,
    shippingService,
    logger
  });
  const customerDeliveriesService = new CustomerDeliveriesService({
    calendar: deliveryCalendar,
    subscriptions: subscriptionDeliveries,
    ups: subscriptionDeliveries,
    stripeAccounts,
    logger,
    shippingQuoteSigner
  });

  return { shippingQuoteSigner, shippingService, customerDeliveriesService, subscriptionDeliveries };
}

module.exports = {
  createShippingQuoteServices
};
