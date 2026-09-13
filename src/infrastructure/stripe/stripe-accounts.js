const { HttpError } = require('../../core/http-error');
const {
  STRIPE_ACCOUNTS,
  DEFAULT_STRIPE_API_VERSION,
  normalizeStripeAccount,
  parseStripeAccountInput
} = require('../../core/stripe-account');
const { StripeBillingClient } = require('./stripe-billing-client');

function notConfiguredError(account) {
  if (account === STRIPE_ACCOUNTS.BR) {
    return new HttpError(503, 'Stripe Brazil is not configured.', {
      code: 'stripe_br_not_configured',
      stripe_account: STRIPE_ACCOUNTS.BR
    });
  }
  return new HttpError(503, 'STRIPE_SECRET_KEY is not configured.', {
    code: 'stripe_secret_missing',
    stripe_account: STRIPE_ACCOUNTS.US
  });
}

function isMissingSecret(client) {
  return Boolean(client && client.missingReason === 'secret');
}

class StripeAccounts {
  constructor(options = {}) {
    this.clients = {
      [STRIPE_ACCOUNTS.US]: options.us || null,
      [STRIPE_ACCOUNTS.BR]: options.br || null
    };
    this.brEnabled = Boolean(options.brEnabled);
    this.webhookSecrets = {
      [STRIPE_ACCOUNTS.US]: options.usWebhookSecret || '',
      [STRIPE_ACCOUNTS.BR]: options.brWebhookSecret || ''
    };
  }

  get(account) {
    const normalized = parseStripeAccountInput(account, STRIPE_ACCOUNTS.US);
    const client = this.clients[normalized];
    if (!client || isMissingSecret(client)) {
      throw notConfiguredError(normalized);
    }
    return client;
  }

  getForCreation(account) {
    const normalized = parseStripeAccountInput(account, STRIPE_ACCOUNTS.US);
    if (normalized === STRIPE_ACCOUNTS.BR && !this.brEnabled) {
      throw new HttpError(503, 'Stripe Brazil is not enabled.', {
        code: 'stripe_br_disabled',
        stripe_account: STRIPE_ACCOUNTS.BR
      });
    }
    return this.get(normalized);
  }

  webhookSecret(account) {
    const normalized = parseStripeAccountInput(account, STRIPE_ACCOUNTS.US);
    return this.webhookSecrets[normalized] || '';
  }
}

function resolveStripeBilling(owner, account, { forCreation = false } = {}) {
  const normalized = parseStripeAccountInput(account, STRIPE_ACCOUNTS.US);
  if (owner && owner.stripeAccounts) {
    return forCreation
      ? owner.stripeAccounts.getForCreation(normalized)
      : owner.stripeAccounts.get(normalized);
  }

  if (forCreation && normalized === STRIPE_ACCOUNTS.BR && owner && owner.stripeBrEnabled === false) {
    throw new HttpError(503, 'Stripe Brazil is not enabled.', {
      code: 'stripe_br_disabled',
      stripe_account: STRIPE_ACCOUNTS.BR
    });
  }

  if (!owner || !owner.stripeBilling) {
    throw notConfiguredError(normalized);
  }

  return owner.stripeBilling;
}

function createStripeAccountsFromEnv(env = {}) {
  const apiVersion = env.STRIPE_API_VERSION || DEFAULT_STRIPE_API_VERSION;
  const maxNetworkRetries = env.STRIPE_MAX_RETRIES;
  const us = new StripeBillingClient({
    account: STRIPE_ACCOUNTS.US,
    secretKey: env.STRIPE_US_SECRET_KEY,
    apiVersion,
    maxNetworkRetries,
    automaticTaxEnabled: env.STRIPE_US_AUTOMATIC_TAX,
    shippingProductId: env.STRIPE_US_SHIPPING_PRODUCT_ID
  });
  const br = new StripeBillingClient({
    account: STRIPE_ACCOUNTS.BR,
    secretKey: env.STRIPE_BR_SECRET_KEY,
    apiVersion,
    maxNetworkRetries,
    automaticTaxEnabled: false,
    shippingProductId: env.STRIPE_BR_SHIPPING_PRODUCT_ID
  });

  return new StripeAccounts({
    us,
    br,
    brEnabled: env.STRIPE_BR_ENABLED,
    usWebhookSecret: env.STRIPE_US_WEBHOOK_SECRET,
    brWebhookSecret: env.STRIPE_BR_WEBHOOK_SECRET
  });
}

module.exports = {
  StripeAccounts,
  createStripeAccountsFromEnv,
  resolveStripeBilling,
  normalizeStripeAccount
};
