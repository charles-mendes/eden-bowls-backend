const { AdminProductionService } = require('../services/admin-production.service');
const { AdminPackStockService } = require('../services/admin-pack-stock.service');

// The production queue moves the charge when the kitchen blocks a cycle before preparation, so it needs the
// delivery calendar (the customer deliveries service). index.js and the wiring test both build it here.
function createAdminProductionService({ ledgerRepository, productionRepository, auditService, customerDeliveriesService, recipeNamesRepository, packStockService, now }) {
  return new AdminProductionService({
    ledgerRepository,
    productionRepository,
    auditService,
    recipeNamesRepository,
    deliverySchedule: customerDeliveriesService,
    packStock: packStockService || null,
    ...(now ? { now } : {})
  });
}

// Ready-pack stock reads the same queue window as the production queue and separates inside its transactions.
function createAdminPackStockService({ stockRepository, ledgerRepository, catalogRepository, auditService, logger, now }) {
  return new AdminPackStockService({
    stockRepository,
    ledgerRepository,
    catalogRepository,
    auditService,
    logger,
    ...(now ? { now } : {})
  });
}

module.exports = {
  createAdminPackStockService,
  createAdminProductionService
};
