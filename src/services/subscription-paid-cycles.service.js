const { HttpError } = require('../core/http-error');

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// The latest courier attempt of an invoice that was not canceled by mistake: a canceled one means no delivery.
function latestCourier(rows) {
  return rows
    .filter((row) => row.status !== 'canceled')
    .reduce((latest, row) => (!latest || Number(row.id) > Number(latest.id) ? row : latest), null);
}

// One paid cycle and how it is leaving, in one shape for every reader (paid-cycles list, customer detail).
function cycleView(cycle, shipment, courier) {
  return {
    invoiceId: cycle.paidInvoiceId,
    preparationDay: dateOnly(cycle.preparationDay),
    productionStatus: cycle.productionStatus || null,
    productionNote: cycle.note == null ? null : String(cycle.note),
    deliveryDate: dateOnly(cycle.deliveryDate),
    paidAt: toIso(cycle.paidAt),
    upsShipment: shipment ? {
      id: shipment.id,
      status: shipment.status,
      trackingNumber: shipment.tracking_number || null
    } : null,
    courierDelivery: courier ? {
      id: courier.id,
      status: courier.status,
      outForDeliveryAt: toIso(courier.out_for_delivery_at),
      deliveredAt: toIso(courier.delivered_at),
      failedAt: toIso(courier.failed_at)
    } : null
  };
}

// The paid cycles of one subscription and how each one is leaving (subscription-paid-cycles). Read from the
// same source as the queues, so nothing here needs Stripe.
class SubscriptionPaidCyclesService {
  constructor(options = {}) {
    this.adminBillingService = options.adminBillingService || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.upsShipmentRepository = options.upsShipmentRepository || null;
    this.courierDeliveryRepository = options.courierDeliveryRepository || null;
  }

  // The UPS shipment and courier attempts of these cycles, in one read each.
  async viewsOf(cycles) {
    const invoiceIds = cycles.map((cycle) => cycle.paidInvoiceId).filter(Boolean);
    const [shipments, courierRows] = await Promise.all([
      this.upsShipmentRepository && invoiceIds.length ? this.upsShipmentRepository.listActiveByInvoiceIds(invoiceIds) : [],
      this.courierDeliveryRepository && invoiceIds.length ? this.courierDeliveryRepository.listByInvoiceIds(invoiceIds) : []
    ]);
    const shipmentByInvoice = new Map(shipments.map((row) => [String(row.stripe_invoice_id), row]));
    const courierByInvoice = new Map();
    for (const row of courierRows) {
      const key = String(row.stripe_invoice_id);
      courierByInvoice.set(key, [...(courierByInvoice.get(key) || []), row]);
    }
    return cycles.map((cycle) => cycleView(
      cycle,
      shipmentByInvoice.get(String(cycle.paidInvoiceId)) || null,
      latestCourier(courierByInvoice.get(String(cycle.paidInvoiceId)) || [])
    ));
  }

  // The newest paid cycle of each subscription, keyed by subscription id (null when none is paid). The rows
  // come already filtered by the caller's market: this does not check scope again.
  async latestBySubscriptions(subscriptions = []) {
    if (!this.ledgerRepository) {
      throw new HttpError(503, 'Subscription ledger is not available.');
    }
    const latest = await Promise.all(subscriptions.map(async (subscription) => {
      const [cycle] = await this.ledgerRepository.listPaidCyclesBySubscription(subscription.id, 1);
      return cycle || null;
    }));
    const views = await this.viewsOf(latest.filter(Boolean));
    const byInvoice = new Map(views.map((view) => [String(view.invoiceId), view]));
    return new Map(subscriptions.map((subscription, index) => [
      String(subscription.id),
      latest[index] ? byInvoice.get(String(latest[index].paidInvoiceId)) || null : null
    ]));
  }

  async list(subscriptionId, actor = {}) {
    if (!this.adminBillingService || !this.ledgerRepository) {
      throw new HttpError(503, 'Subscription ledger is not available.');
    }
    // Answers 404 for a subscription of another market, as every subscription route does.
    const subscription = await this.adminBillingService.getSubscription(subscriptionId, actor);
    const cycles = await this.ledgerRepository.listPaidCyclesBySubscription(subscription.id || subscriptionId, 24);
    const views = await this.viewsOf(cycles);

    return {
      success: true,
      data: {
        items: views.map((view) => ({
          invoice_id: view.invoiceId,
          preparation_day: view.preparationDay,
          production_status: view.productionStatus,
          delivery_date: view.deliveryDate,
          paid_at: view.paidAt,
          ups_shipment: view.upsShipment ? {
            id: view.upsShipment.id,
            status: view.upsShipment.status,
            tracking_number: view.upsShipment.trackingNumber
          } : null,
          courier_delivery: view.courierDelivery ? {
            id: view.courierDelivery.id,
            status: view.courierDelivery.status,
            out_for_delivery_at: view.courierDelivery.outForDeliveryAt,
            delivered_at: view.courierDelivery.deliveredAt,
            failed_at: view.courierDelivery.failedAt
          } : null
        }))
      }
    };
  }
}

module.exports = { SubscriptionPaidCyclesService };
