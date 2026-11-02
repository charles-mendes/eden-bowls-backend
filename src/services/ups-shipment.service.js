const { HttpError } = require('../core/http-error');
const { isPoBoxAddress } = require('../core/po-box');
const { assertStripeAccountMarket, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { ledgerStripeAccount } = require('../core/stripe-account');
const { extractSubscriptionIdFromInvoice } = require('../core/stripe-subscription-map');
const { parseUpsTracking, upsTrackingUrl } = require('../core/ups-tracking');

function addressRecipient(address = {}) {
  return String(address.name || address.full_name || address.recipient || '').trim();
}

function normalizeShipTo(address = {}) {
  return {
    name: addressRecipient(address),
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
    this.profileRepository = options.profileRepository || null;
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
      tracking_url: upsTrackingUrl(shipment.tracking_number),
      tracking_status: shipment.tracking_status || null,
      tracking_description: shipment.tracking_description || null,
      tracking_checked_at: shipment.tracking_checked_at || null,
      delivered_at: shipment.delivered_at || null,
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
    const subscription = await this.requireSubscriptionInScope(subscriptionId, actor);
    const items = await this.repository.listBySubscriptionId(subscriptionId);
    return {
      success: true,
      data: {
        items: items.map((item) => this.present(item)),
        label_issues: await this.listLabelIssues(subscription)
      }
    };
  }

  async listLabelIssues(subscription) {
    const { issues } = await this.inspectLabel(subscription || {});
    const configured = this.upsClient && this.upsClient.isConfigured();
    return [
      ...(configured ? [] : [{ code: 'ups_not_configured' }]),
      ...issues.map(({ code, country }) => (country ? { code, country } : { code }))
    ];
  }

  async createForSubscription({ subscriptionId, invoiceId, actor }) {
    this.ensureRepository();
    this.ensureUps();

    const invoice = String(invoiceId || '').trim();
    if (!invoice) {
      throw new HttpError(400, 'invoice_id is required.', { code: 'invoice_id_required' });
    }

    if (!this.adminBillingService) {
      throw new HttpError(503, 'Billing service is not available.');
    }
    const subscription = await this.adminBillingService.getSubscription(subscriptionId, actor);
    await this.requirePaidInvoice(subscriptionId, subscription, invoice, actor);

    const existing = await this.repository.findActiveByInvoiceId(invoice);
    if (existing) {
      return this.reuseExisting(existing);
    }

    const { shipTo, settings, shipFrom, issues } = await this.inspectLabel(subscription);
    if (issues.length) {
      const [issue] = issues;
      throw new HttpError(422, issue.message, { code: issue.code });
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

  // A label costs money: only a paid invoice of this subscription can buy one.
  async requirePaidInvoice(subscriptionId, subscription, invoiceId, actor) {
    const invoice = await this.adminBillingService.getSubscriptionInvoice(subscriptionId, invoiceId, actor);
    if (extractSubscriptionIdFromInvoice(invoice) !== subscription.stripeSubscriptionId) {
      throw new HttpError(422, 'This invoice does not belong to the subscription.', { code: 'invoice_not_in_subscription' });
    }
    if (invoice.status !== 'paid') {
      throw new HttpError(422, 'Only a paid invoice can buy a UPS label.', { code: 'invoice_not_paid' });
    }
  }

  // The checkout address has no name, so the account name goes on the label.
  async resolveRecipientName(subscription) {
    const fromAddress = addressRecipient(subscription.address || {});
    if (fromAddress) {
      return fromAddress;
    }
    const userId = (subscription.user && subscription.user.id) || subscription.userId;
    const user = this.profileRepository ? await this.profileRepository.findUserById(userId) : null;
    const name = String((user && user.displayName) || '').trim();
    return name.includes('@') ? '' : name;
  }

  // Everything that stops a label before UPS is called, so the panel can warn ahead of the click.
  async inspectLabel(subscription) {
    const address = subscription.address || {};
    const shipTo = normalizeShipTo(address);
    const settings = this.shippingService?.settings?.us || {};
    const shipFrom = settings.ship_from || {};
    const issues = [];

    if (shipTo.country !== 'US') {
      issues.push({ code: 'country_not_supported', message: 'UPS shipments are only available for US addresses.', country: shipTo.country });
    } else if (isPoBoxAddress(shipTo.street, shipTo.street2)) {
      issues.push({ code: 'po_box_not_allowed', message: 'UPS cannot deliver to a P.O. Box. Please use a street address.' });
    } else if (![shipTo.street, shipTo.city, shipTo.state, shipTo.zipcode].every((value) => String(value).trim())) {
      issues.push({ code: 'address_incomplete', message: 'The delivery address is incomplete.' });
    }
    if (!String(shipFrom.zipcode || '').replace(/\D/g, '')) {
      issues.push({ code: 'ship_from_missing', message: 'US ship-from is not configured.' });
    }
    shipTo.name = await this.resolveRecipientName(subscription);
    if (!shipTo.name) {
      issues.push({ code: 'recipient_name_missing', message: 'The customer has no name for the label. Fill in the account name first.' });
    }

    return { shipTo, settings, shipFrom, issues };
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
    if (shipment.status === 'delivered') {
      throw new HttpError(422, 'A delivered shipment cannot be voided.', { code: 'shipment_delivered' });
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

  async refreshTracking(shipmentId, actor = {}) {
    const shipment = await this.requireShipmentInScope(shipmentId, actor);
    this.ensureUps();
    if (!shipment.tracking_number) {
      throw new HttpError(422, 'Shipment has no tracking number.', { code: 'missing_tracking' });
    }
    const raw = await this.upsClient.track(shipment.tracking_number);
    const updated = await this.repository.recordTracking(shipment.id, parseUpsTracking(raw), raw);
    return { success: true, data: { shipment: this.present(updated) } };
  }
}

module.exports = {
  UpsShipmentService,
  normalizeShipTo,
  upsRejectedShipment,
  withoutLabelImages
};
