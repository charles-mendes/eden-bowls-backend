const { HttpError } = require('../../core/http-error');
const { buildPetsSnapshot } = require('../../core/stripe-subscription-map');
const { buildCurrentHash } = require('../../core/subscription-edit-hash');
const {
  shippingCostFrom,
  extractStripeItemRefs,
  diffSubscriptionItems,
  mapProrationFromInvoice,
  resolveProposedPlan,
  assertLedgerMarket,
  parseEditFiscal
} = require('../../core/subscription-edit-plan');
const { isChargedDeliveryInvoice, startNewContract } = require('../../core/contract-deliveries');
const { ledgerStripeAccount } = require('../../core/stripe-account');
const { resolveStripeBilling } = require('../stripe/stripe-accounts');
const { extractInvoicePayment } = require('../stripe/stripe-billing-client');
const { verifiedEditShipping } = require('../../core/shipping-quote-token');
const { resolveMarket } = require('../../core/market');
const { assertPackOnlyChange, withStoredPets } = require('../../core/pack-adjustment');

function itemsUnchanged(currentItems, itemUpdates) {
  if (itemUpdates.length !== currentItems.length) return false;
  return itemUpdates.every((update) => {
    if (update.deleted || !update.id) return false;
    const current = currentItems.find((item) => item.id === update.id);
    return Boolean(current) && Number(current.quantity) === Number(update.quantity);
  });
}

function addressWithTransit(address, shipping) {
  if (!address || resolveMarket({ country: address.country }).country !== 'US') return address;
  if (!shipping || shipping.delivery_days == null || shipping.delivery_days === '') return address;
  const days = Number(shipping.delivery_days);
  return Number.isFinite(days) ? { ...address, business_days_in_transit: days } : address;
}

// The edit sends the whole address and replaces the stored one, so an omitted recipient is copied from it.
function withStoredRecipient(address, storedAddress) {
  if (!address || address.recipient_name !== undefined) return address;
  const stored = storedAddress && typeof storedAddress === 'object' ? storedAddress.recipient_name : undefined;
  return stored ? { ...address, recipient_name: stored } : address;
}

class SubscriptionsEditCommitRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.planPreviewRepository = options.planPreviewRepository || null;
    this.resolveSubscriptionItems = options.resolveSubscriptionItems || null;
    this.shippingQuoteSigner = options.shippingQuoteSigner || null;
    this.transactionalMailer = options.transactionalMailer || null;
    this.fiscalRepository = options.fiscalRepository || null;
    this.blingNfeService = options.blingNfeService || null;
    this.addressIssueService = options.addressIssueService || null;
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
  }

  // After Stripe and the ledger took the edit: the CPF and the fiscal name are the account's, for every subscription.
  async saveFiscal(userId, fiscal = {}) {
    if (!fiscal.taxDocument && !fiscal.fiscalName) return;
    if (!this.fiscalRepository) {
      throw new HttpError(503, 'Fiscal data cannot be saved.');
    }
    if (fiscal.taxDocument) await this.fiscalRepository.saveTaxDocument(userId, fiscal.taxDocument);
    if (fiscal.fiscalName) await this.fiscalRepository.saveFiscalName(userId, fiscal.fiscalName);
    // The edit is saved: a note that cannot be unblocked now waits for the next save, so its error does not surface.
    if (this.blingNfeService) {
      try {
        await this.blingNfeService.refreshBlockedForUser(userId);
      } catch (error) {
        this.logger.warn({ userId, message: error && error.message }, 'Blocked NF-e notes were not read again.');
      }
    }
  }

  // With `defer`, validates the save (hash, plan, prices) and returns it without touching Stripe or the ledger.
  async commit(userId, subscriptionId, requestPayload = {}, ledgerRow = null, options = {}) {
    if (!this.ledgerRepository) {
      throw new HttpError(503, 'Subscription edit commit dependencies are not available.');
    }

    const row = ledgerRow || await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
    if (!row) {
      throw new HttpError(404, 'Subscription not found.', { code: 'subscription_not_found' });
    }
    // A pack save applies from the editable delivery forward: the next monthly invoice carries it, nothing is charged now.
    const packMode = Boolean(requestPayload.delivery_id);
    if (packMode) assertPackOnlyChange(requestPayload, row);
    const payload = assertLedgerMarket(
      packMode ? withStoredPets(requestPayload, row.planSelection) : requestPayload,
      row
    );
    const fiscal = parseEditFiscal(payload, row);
    const shipping = verifiedEditShipping(this.shippingQuoteSigner, row, payload);

    const stripeBilling = resolveStripeBilling(this, ledgerStripeAccount(row));
    const subscription = await stripeBilling.retrieveSubscription(subscriptionId);
    const currentItems = extractStripeItemRefs(subscription);
    if (currentItems.length === 0) {
      throw new HttpError(422, 'Subscription has no Stripe items.', { code: 'invalid_plan' });
    }

    const currentHash = buildCurrentHash({
      items: currentItems.map((item) => ({ price: item.price, quantity: item.quantity })),
      termMonths: row.subscriptionTermMonths,
      address: row.address || {},
      shipping: row.shipping || {}
    });
    if (currentHash !== payload.expected_current_hash) {
      throw new HttpError(409, 'Subscription state changed. Preview again.', {
        code: 'subscription_state_changed'
      });
    }

    const proposed = await resolveProposedPlan(this.planPreviewRepository, this.resolveSubscriptionItems, {
      userId,
      payload,
      currentSelection: row.planSelection
    });
    const itemUpdates = diffSubscriptionItems(currentItems, proposed.items);
    if (options.defer) {
      const lines = proposed.resolved && proposed.resolved.catalog_pricing
        ? proposed.resolved.catalog_pricing.line_items || []
        : [];
      return {
        subscription_id: subscriptionId,
        stripe_account: ledgerStripeAccount(row),
        proration: { direction: 'none', amount_due_now: 0, credit_applied: 0, currency: proposed.currency },
        packs_per_month: lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0), 0),
        subtotal: proposed.catalogSubtotal,
        edit_payment_pending: false
      };
    }
    const currentTerm = Number(row.subscriptionTermMonths || 1);
    const proposedTerm = Number(payload.subscription_term_months || currentTerm);
    const termChange = currentTerm !== proposedTerm;
    // An address or shipping change alone must not invoice now or move the renewal.
    const deliveryOnly = packMode || (!termChange && itemsUnchanged(currentItems, itemUpdates));

    let proration = { direction: 'none', amount_due_now: 0, credit_applied: 0, currency: proposed.currency };
    if (!deliveryOnly) {
      try {
        const previewInvoice = await stripeBilling.previewProration({
          subscriptionId,
          items: itemUpdates
        });
        proration = mapProrationFromInvoice(previewInvoice, proposed.currency);
      } catch (_error) {
        proration = { direction: 'none', amount_due_now: 0, credit_applied: 0, currency: proposed.currency };
      }
    }

    if (proration.direction === 'charge') {
      const paymentMethodId = String(payload.payment_method_id || subscription.default_payment_method || '').trim();
      const pmId = paymentMethodId.startsWith('pm_')
        ? paymentMethodId
        : (subscription.default_payment_method && subscription.default_payment_method.id
          ? String(subscription.default_payment_method.id)
          : '');
      if (!pmId.startsWith('pm_')) {
        throw new HttpError(422, 'A payment method is required to charge the proration.', {
          code: 'invalid_payment_method'
        });
      }
    }

    if (termChange) {
      await this.seedChargedCount(row, stripeBilling);
    }

    const shippingCost = shippingCostFrom(shipping);
    const metadata = {
      ...(subscription.metadata || {}),
      wp_user_id: String(userId),
      user_id: String(userId),
      source: 'eden_bowls_node',
      subscription_term_months: String(proposedTerm),
      eden_env: String(process.env.EDEN_RUNTIME || '').trim()
    };
    if (!metadata.eden_env) {
      throw new HttpError(500, 'EDEN_RUNTIME must be local, qa, or production.');
    }
    if (shippingCost > 0) {
      metadata.shipping_amount_minor = String(Math.round(shippingCost * 100));
      metadata.shipping_currency = String(proposed.currency || 'usd').toLowerCase();
      if (stripeBilling.shippingProductId) {
        metadata.shipping_product_id = String(stripeBilling.shippingProductId);
      }
    }

    const updated = await stripeBilling.updateSubscriptionItems({
      subscriptionId,
      items: itemUpdates,
      metadata,
      prorationBehavior: deliveryOnly
        ? 'none'
        : (proration.direction === 'charge' ? 'always_invoice' : 'create_prorations')
    });

    const invoice = updated.latest_invoice && typeof updated.latest_invoice === 'object'
      ? updated.latest_invoice
      : {};
    const payment = extractInvoicePayment(invoice);
    const paymentIntentStatus = payment.paymentIntentStatus;
    const invoicePaid = invoice.status === 'paid';
    const paymentState = stripeBilling.resolvePaymentState({
      paymentMethodId: payload.payment_method_id || (updated.default_payment_method && updated.default_payment_method.id),
      paymentIntentStatus: paymentIntentStatus || (proration.direction === 'charge' && !invoicePaid ? 'requires_confirmation' : 'succeeded')
    });
    // The current API returns only confirmation_secret, with no payment intent status.
    const needsConfirmation = Boolean(payment.clientSecret) && !invoicePaid
      && ['', 'requires_action', 'requires_confirmation'].includes(paymentIntentStatus);
    const editPaymentPending = proration.direction === 'charge' && (needsConfirmation || paymentState === 'requires_confirmation');

    const nextPlanSelection = {
      ...proposed.planSelection,
      subscription_term_months: proposedTerm
    };
    const nextPets = buildPetsSnapshot(nextPlanSelection);
    const savedAddress = payload.address
      ? addressWithTransit(withStoredRecipient(payload.address, row.address), shipping)
      : row.address;

    // Before the term is saved: a failure here leaves the old term, and saving again repeats both steps safely.
    if (termChange && !editPaymentPending) {
      await startNewContract({ ledgerRepository: this.ledgerRepository, billing: stripeBilling, row, subscriptionId });
    }

    if (editPaymentPending) {
      await this.ledgerRepository.upsert({
        userId,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: row.stripeCustomerId,
        stripeAccount: ledgerStripeAccount(row),
        status: row.status,
        editPaymentPending: true,
        editPending: {
          plan_selection: nextPlanSelection,
          term_months: proposedTerm,
          term_changed: termChange,
          shipping,
          invoice_id: invoice.id || null,
          payment_intent_id: payment.paymentIntentId || null
        }
      });
    } else {
      await this.ledgerRepository.upsert({
        userId,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: row.stripeCustomerId,
        stripeAccount: ledgerStripeAccount(row),
        status: row.status,
        planSelection: nextPlanSelection,
        petsSnapshot: nextPets,
        shipping,
        address: savedAddress,
        subscriptionTermMonths: proposedTerm,
        editPaymentPending: false,
        editPending: null
      });
      await this.notifyPlanChangedMail({
        row,
        subscriptionId,
        invoice,
        nextPlanSelection,
        nextPets,
        shipping,
        address: savedAddress,
        proposedTerm,
        proposed
      });
    }

    await this.saveFiscal(userId, fiscal);
    // delivery-address-issues: every open problem of the account is checked again, the fiscal data being the
    // account's; a saved address also clears the courier's refusal of the old one. Only logs its own errors.
    if (this.addressIssueService) {
      await this.addressIssueService.recheckForUser(userId, { addressSavedFor: payload.address ? [subscriptionId] : [] });
    }

    return {
      subscription_id: subscriptionId,
      stripe_account: ledgerStripeAccount(row),
      pending_webhook_confirmation: true,
      term_change: termChange,
      proration,
      payment_state: editPaymentPending ? 'requires_confirmation' : (proration.direction === 'charge' ? paymentState : 'paid'),
      stripe_invoice_id: invoice.id || undefined,
      stripe_payment_intent_id: payment.paymentIntentId || undefined,
      stripe_client_secret: editPaymentPending ? (payment.clientSecret || null) : null,
      stripe_payment_intent_status: paymentIntentStatus || undefined,
      edit_payment_pending: editPaymentPending
    };
  }

  // Without the lifetime count, the new contract's start would be 0 and every earlier invoice would count once seeded.
  async seedChargedCount(row, stripeBilling) {
    if (row.chargedDeliveries != null) return;
    let invoices;
    try {
      invoices = await stripeBilling.listPaidInvoicesForSubscription(row.stripeSubscriptionId);
    } catch (_error) {
      throw new HttpError(502, 'Unable to read the charged deliveries.', { code: 'contract_count_unavailable' });
    }
    const earlier = invoices.filter((item) => item.id && isChargedDeliveryInvoice(item)).map((item) => item.id);
    await this.ledgerRepository.seedChargedDeliveries(row.stripeSubscriptionId, earlier);
  }

  async notifyPlanChangedMail({
    row,
    subscriptionId,
    invoice,
    nextPlanSelection,
    nextPets,
    shipping,
    address,
    proposedTerm,
    proposed
  }) {
    if (!this.transactionalMailer || typeof this.transactionalMailer.notifyPlanChanged !== 'function') {
      return;
    }

    const referenceId = invoice.id
      ? `plan:${invoice.id}`
      : `plan:${buildCurrentHash({
        items: proposed.items || [],
        termMonths: proposedTerm,
        address: address || {},
        shipping: shipping || {}
      })}`;

    try {
      await this.transactionalMailer.notifyPlanChanged({
        ledger: {
          ...row,
          planSelection: nextPlanSelection,
          petsSnapshot: nextPets,
          shipping,
          address,
          subscriptionTermMonths: proposedTerm,
          stripeAccount: ledgerStripeAccount(row)
        },
        subscriptionId,
        referenceId,
        invoice
      });
    } catch (error) {
      this.logger.error({
        template: 'plan_changed',
        subscriptionId,
        code: error && error.code ? error.code : 'smtp_failed'
      }, 'Transactional email failed.');
    }
  }
}

module.exports = {
  SubscriptionsEditCommitRepository
};
