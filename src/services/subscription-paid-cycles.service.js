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

// The paid cycles of one subscription and how each one is leaving (subscription-paid-cycles). Read from the
// same source as the queues, so nothing here needs Stripe.
class SubscriptionPaidCyclesService {
  constructor(options = {}) {
    this.adminBillingService = options.adminBillingService || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.upsShipmentRepository = options.upsShipmentRepository || null;
    this.courierDeliveryRepository = options.courierDeliveryRepository || null;
  }

  async list(subscriptionId, actor = {}) {
    if (!this.adminBillingService || !this.ledgerRepository) {
      throw new HttpError(503, 'Subscription ledger is not available.');
    }
    // Answers 404 for a subscription of another market, as every subscription route does.
    const subscription = await this.adminBillingService.getSubscription(subscriptionId, actor);
    const cycles = await this.ledgerRepository.listPaidCyclesBySubscription(subscription.id || subscriptionId, 24);
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

    return {
      success: true,
      data: {
        items: cycles.map((cycle) => {
          const shipment = shipmentByInvoice.get(String(cycle.paidInvoiceId)) || null;
          const courier = latestCourier(courierByInvoice.get(String(cycle.paidInvoiceId)) || []);
          return {
            invoice_id: cycle.paidInvoiceId,
            preparation_day: dateOnly(cycle.preparationDay),
            production_status: cycle.productionStatus || null,
            delivery_date: dateOnly(cycle.deliveryDate),
            paid_at: toIso(cycle.paidAt),
            ups_shipment: shipment ? {
              id: shipment.id,
              status: shipment.status,
              tracking_number: shipment.tracking_number || null
            } : null,
            courier_delivery: courier ? {
              id: courier.id,
              status: courier.status,
              out_for_delivery_at: toIso(courier.out_for_delivery_at),
              delivered_at: toIso(courier.delivered_at),
              failed_at: toIso(courier.failed_at)
            } : null
          };
        })
      }
    };
  }
}

module.exports = { SubscriptionPaidCyclesService };
