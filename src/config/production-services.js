const { AdminProductionService } = require('../services/admin-production.service');

// The production queue moves the charge when the kitchen blocks a cycle before preparation, so it needs the
// delivery calendar (the customer deliveries service). index.js and the wiring test both build it here.
function createAdminProductionService({ ledgerRepository, productionRepository, auditService, customerDeliveriesService, now }) {
  return new AdminProductionService({
    ledgerRepository,
    productionRepository,
    auditService,
    deliverySchedule: customerDeliveriesService,
    ...(now ? { now } : {})
  });
}

module.exports = {
  createAdminProductionService
};
