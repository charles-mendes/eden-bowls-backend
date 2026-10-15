const { HttpError } = require('../core/http-error');
const { assertNotPoBoxAddress } = require('../core/po-box');
const { assertStripeAccountMarket, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { ledgerStripeAccount } = require('../core/stripe-account');

function normalizeShipTo(address = {}) {
  return {
    name: address.name || address.full_name || address.recipient || 'Customer',
    street: address.line1 || address.address || address.street || address.address1 || '',
    street2: address.line2 || address.street2 || address.address2 || address.complement || '',
    city: address.city || '',
    state: address.state || address.region || '',
    zipcode: address.postal_code || address.zipcode || address.zipCode || address.postal || '',
    country: String(address.country || 'US').toUpperCase(),
    phone: address.phone || address.phone_number || ''
  };
}

const LABEL_IMAGE_KEYS = new Set(['GraphicImage', 'GraphicImagePart', 'HTMLImage']);

// The label file is stored on disk. The database copy keeps the UPS response without the image.
function withoutLabelImages(raw) {
  if (raw == null) {
    return raw;
  }
  return JSON.parse(JSON.stringify(raw, (key, value) => (LABEL_IMAGE_KEYS.has(key) ? undefined : value)));
}

// True only when UPS cannot have bought a label: the token step failed, or UPS answered 4xx.
// Timeouts, network errors, 5xx and incomplete answers leave the outcome unknown.
function upsRejectedShipment(error) {
  const details = (error && error.details) || {};
  if (details.stage === 'oauth' || details.code === 'ups_not_configured') {
    return true;
  }
  const status = Number(details.status);
  return details.code === 'ups_upstream_error' && status >= 400 && status < 500;
}

function unresolvedShipmentError(shipment) {
  return new HttpError(409, 'A UPS shipment for this invoice has no confirmed outcome. Check UPS, then void it before buying another label.', {
    code: 'ups_shipment_unresolved',
    shipment_id: shipment.id
  });
}

class UpsShipmentService {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.upsClient = options.upsClient || null;
    this.labelStorage = options.labelStorage || null;
    this.shippingService = options.shippingService || null;
    this.adminBillingService = options.adminBillingService || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.transactionalMailer = options.transactionalMailer || null;
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
  }

  ensureRepository() {
    if (!this.repository) {
      throw new HttpError(503, 'UPS shipment repository is not available.');
    }
  }

  ensureUps() {
    if (!this.upsClient || !this.upsClient.isConfigured()) {
      throw new HttpError(503, 'UPS is not configured.', { code: 'ups_not_configured' });
    }
  }

  present(shipment) {
    if (!shipment) {
      return null;
    }
    return {
      id: shipment.id,
      subscription_id: shipment.subscription_id,
      stripe_invoice_id: shipment.stripe_invoice_id,
      ups_shipment_id: shipment.ups_shipment_id,
      tracking_number: shipment.tracking_number,
      service_code: shipment.service_code,
      label_format: shipment.label_format,
      has_label: Boolean(shipment.label_path),
      quoted_shipping_cost: shipment.quoted_shipping_cost,
      ups_monetary_value: shipment.ups_monetary_value,
      status: shipment.status,
      shipped_at: shipment.shipped_at,
      created_at: shipment.created_at,
      updated_at: shipment.updated_at
    };
  }

  async requireSubscriptionInScope(subscriptionId, actor) {
    if (this.adminBillingService && typeof this.adminBillingService.getSubscription === 'function') {
      return this.adminBillingService.getSubscription(subscriptionId, actor);
    }
    if (!this.ledgerRepository) {
      return null;
    }
    const item = await this.ledgerRepository.findById(subscriptionId);
    if (!item) {
      throw new HttpError(404, 'Subscription not found.');
    }
    if (shouldEnforceMarketScope(actor)) {
      assertStripeAccountMarket(actor, ledgerStripeAccount(item));
    }
    return item;
  }

  async requireShipmentInScope(shipmentId, actor) {
    this.ensureRepository();
    const shipment = await this.repository.findById(shipmentId);
    if (!shipment) {
      throw new HttpError(404, 'Shipment not found.');
    }
    await this.requireSubscriptionInScope(shipment.subscription_id, actor);
    return shipment;
  }

  async listForSubscription(subscriptionId, actor = {}) {
    this.ensureRepository();
    await this.requireSubscriptionInScope(subscriptionId, actor);
    const items = await this.repository.listBySubscriptionId(subscriptionId);
    return {
      success: true,
      data: { items: items.map((item) => this.present(item)) }
    };
  }

  async createForSubscription({ subscriptionId, invoiceId, actor }) {
    this.ensureRepository();
    this.ensureUps();

    const invoice = String(invoiceId || '').trim();
    if (!invoice) {
      throw new HttpError(400, 'invoice_id is required.', { code: 'invoice_id_required' });
    }

    await this.requireSubscriptionInScope(subscriptionId, actor);

    const existing = await this.repository.findActiveByInvoiceId(invoice);
    if (existing) {
      return this.reuseExisting(existing);
    }

    if (!this.adminBillingService) {
      throw new HttpError(503, 'Billing service is not available.');
    }
    const subscription = await this.adminBillingService.getSubscription(subscriptionId, actor);
    const address = subscription.address || {};
    const shipTo = normalizeShipTo(address);
    assertNotPoBoxAddress({
      line1: shipTo.street,
      line2: shipTo.street2
    });

    if (String(shipTo.country || 'US').toUpperCase() !== 'US') {
      throw new HttpError(422, 'UPS shipments are only available for US addresses.', { code: 'country_not_supported' });
    }

    const settings = this.shippingService?.settings?.us || {};
    const shipFrom = settings.ship_from || {};
    if (!String(shipFrom.zipcode || '').replace(/\D/g, '')) {
      throw new HttpError(422, 'US ship-from is not configured.', { code: 'ship_from_missing' });
    }

    const quoted = Number(subscription.shipping?.cost || subscription.shipping?.total || settings.cost || 0);
    const serviceCode = Array.isArray(settings.allowed_service_codes) && settings.allowed_service_codes[0]
      ? settings.allowed_service_codes[0]
      : '03';

    const pending = await this.repository.insertPending({
      subscriptionId: String(subscription.id || subscriptionId),
      invoiceId: invoice,
      userId: subscription.user?.id || null,
      quotedShippingCost: quoted
    });
    if (!pending) {
      // Another request inserted the row for this invoice first.
      const winner = await this.repository.findActiveByInvoiceId(invoice);
      if (winner) {
        return this.reuseExisting(winner);
      }
      throw new HttpError(409, 'Another UPS shipment request for this invoice is in progress.', { code: 'ups_shipment_in_progress' });
    }

    let created;
    try {
      created = await this.upsClient.createShipment({
        shipFrom,
        shipTo,
        package: settings.package,
        serviceCode
      });
    } catch (error) {
      if (upsRejectedShipment(error)) {
        await this.repository.deletePending(pending.id).catch(() => {});
        throw error;
      }
      await this.repository.markUnknown(pending.id).catch((markError) => {
        this.logger.error({ shipmentId: pending.id, code: markError && markError.code }, 'UPS shipment could not be marked unknown.');
      });
      this.logger.error({
        shipmentId: pending.id,
        invoiceId: invoice,
        code: error && error.details && error.details.code,
        status: error && error.details && error.details.status
      }, 'UPS shipment outcome is unknown.');
      throw new HttpError(502, 'UPS did not confirm the shipment. Check UPS before buying another label.', {
        code: 'ups_shipment_unknown',
        shipment_id: pending.id
      });
    }

    // From here UPS has bought the label, so the pending row is never deleted on failure.
    const recovered = await this.repository.findByUpsShipmentId(created.upsShipmentId);
    if (recovered && recovered.id !== pending.id) {
      await this.repository.deletePending(pending.id);
      return { success: true, data: { shipment: this.present(recovered), reused: true } };
    }

    let labelPath = null;
    if (created.labelBase64 && this.labelStorage) {
      try {
        labelPath = await this.labelStorage.write({
          invoiceId: invoice,
          format: created.labelFormat || 'gif',
          buffer: Buffer.from(created.labelBase64, 'base64')
        });
      } catch (error) {
        this.logger.error({ shipmentId: pending.id, code: error && error.code }, 'UPS label file could not be stored.');
      }
    }

    let saved;
    try {
      saved = await this.repository.markCreated(pending.id, {
        upsShipmentId: created.upsShipmentId,
        trackingNumber: created.trackingNumber,
        serviceCode: created.serviceCode,
        labelFormat: created.labelFormat || 'GIF',
        labelPath,
        upsMonetaryValue: created.monetaryValue,
        // Without a stored file the response is the only copy of the label.
        rawResponse: labelPath ? withoutLabelImages(created.raw) : created.raw
      });
    } catch (error) {
      this.logger.error({
        shipmentId: pending.id,
        upsShipmentId: created.upsShipmentId,
        code: error && error.code
      }, 'UPS bought a label that could not be saved.');
      throw error;
    }

    await this.notifyShippedMail({ subscription, shipment: saved });

    return { success: true, data: { shipment: this.present(saved), reused: false } };
  }

  reuseExisting(existing) {
    if (existing.status === 'created' || existing.ups_shipment_id) {
      return { success: true, data: { shipment: this.present(existing), reused: true } };
    }
    throw unresolvedShipmentError(existing);
  }

  async notifyShippedMail({ subscription, shipment }) {
    if (!this.transactionalMailer) {
      return;
    }

    try {
      await this.transactionalMailer.notifyShipped({ subscription, shipment });
    } catch (error) {
      this.logger.error({
        shipmentId: shipment && shipment.id,
        to: subscription && subscription.user && subscription.user.email,
        code: error && error.code
      }, 'Transactional email failed.');
    }
  }

  async getLabel(shipmentId, actor = {}) {
    const shipment = await this.requireShipmentInScope(shipmentId, actor);
    if (!shipment.label_path || !this.labelStorage) {
      throw new HttpError(404, 'Label file not found.', { code: 'label_not_found' });
    }
    const buffer = await this.labelStorage.read(shipment.label_path);
    if (!buffer) {
      throw new HttpError(404, 'Label file not found.', { code: 'label_not_found' });
    }
    return {
      shipment,
      buffer,
      contentType: String(shipment.label_format || '').toUpperCase() === 'PDF'
        ? 'application/pdf'
        : 'image/gif',
      filename: shipment.label_path
    };
  }

  // A row without a UPS id (pending or unknown) is closed locally only when the operator confirms
  // in UPS that no label exists for it, or has voided that label there.
  async voidShipment(shipmentId, actor = {}, options = {}) {
    const shipment = await this.requireShipmentInScope(shipmentId, actor);
    if (shipment.status === 'voided') {
      return { success: true, data: { shipment: this.present(shipment) } };
    }
    if (!shipment.ups_shipment_id) {
      if (shipment.status !== 'pending' && shipment.status !== 'unknown') {
        throw new HttpError(422, 'Shipment has no UPS id to void.', { code: 'missing_ups_id' });
      }
      if (options.confirmNotCreated !== true) {
        throw unresolvedShipmentError(shipment);
      }
      const closed = await this.repository.markVoided(shipment.id);
      return { success: true, data: { shipment: this.present(closed), local_only: true } };
    }
    this.ensureUps();
    await this.upsClient.voidShipment(shipment.ups_shipment_id);
    const voided = await this.repository.markVoided(shipment.id);
    return { success: true, data: { shipment: this.present(voided) } };
  }

  async refreshTracking(shipmentId) {
    this.ensureRepository();
    this.ensureUps();
    const shipment = await this.repository.findById(shipmentId);
    if (!shipment) {
      throw new HttpError(404, 'Shipment not found.');
    }
    if (!shipment.tracking_number) {
      throw new HttpError(422, 'Shipment has no tracking number.', { code: 'missing_tracking' });
    }
    const raw = await this.upsClient.track(shipment.tracking_number);
    const updated = await this.repository.updateTracking(shipment.id, shipment.tracking_number, raw);
    return {
      success: true,
      data: {
        shipment: this.present(updated),
        tracking: raw
      }
    };
  }
}

module.exports = {
  UpsShipmentService,
  normalizeShipTo,
  upsRejectedShipment,
  withoutLabelImages
};
