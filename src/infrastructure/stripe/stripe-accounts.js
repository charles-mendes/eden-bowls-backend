const fs = require('fs');
const path = require('path');
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
  return new HttpError(503, 'STRIPE_US_SECRET_KEY is not configured.', {
    code: 'stripe_secret_missing',
    stripe_account: STRIPE_ACCOUNTS.US
  });
}

// Written by scripts/dev-with-stripe-listen.js with the `stripe listen` session secrets.
const DEFAULT_WEBHOOK_SECRETS_FILE = path.resolve(__dirname, '../../../.local/stripe-webhook-secrets.json');

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
    this.nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
    this.webhookSecretsFile = options.webhookSecretsFile
      || process.env.STRIPE_WEBHOOK_SECRETS_FILE
      || DEFAULT_WEBHOOK_SECRETS_FILE;
    this.logger = options.logger || null;
    this.warnedReasons = new Set();
  }

  // Dev only: the local listener secret is read on every webhook so a new
  // `stripe listen` session works without restarting the API.
  usesListenerSecrets() {
    return this.nodeEnv === 'development';
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
    if (this.usesListenerSecrets()) {
      const listenerSecret = this.readListenerSecret(normalized);
      if (listenerSecret) {
        return listenerSecret;
      }
    }
    return this.webhookSecrets[normalized] || '';
  }

  readListenerSecret(account) {
    let raw;
    try {
      raw = fs.readFileSync(this.webhookSecretsFile, 'utf8');
    } catch (error) {
      this.warnOnce(`read:${error.code || 'error'}`, error.code === 'ENOENT'
        ? 'Stripe listener secrets file not found; using the webhook secret from the environment.'
        : 'Could not read the Stripe listener secrets file; using the webhook secret from the environment.');
      return '';
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.warnOnce('invalid_json', 'Stripe listener secrets file is not valid JSON; using the webhook secret from the environment.');
      return '';
    }

    const secret = parsed && typeof parsed[account] === 'string' ? parsed[account].trim() : '';
    if (!secret) {
      this.warnOnce(`empty:${account}`, `Stripe listener secrets file has no ${account} secret; using the webhook secret from the environment.`);
    }
    return secret;
  }

  warnOnce(reason, message) {
    if (!this.logger || this.warnedReasons.has(reason)) {
      return;
    }
    this.warnedReasons.add(reason);
    this.logger.warn({ file: this.webhookSecretsFile }, message);
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

function createStripeAccountsFromEnv(env = {}, { logger } = {}) {
  const apiVersion = env.STRIPE_API_VERSION || DEFAULT_STRIPE_API_VERSION;
  const maxNetworkRetries = env.STRIPE_MAX_RETRIES;
  const us = new StripeBillingClient({
    account: STRIPE_ACCOUNTS.US,
    secretKey: env.STRIPE_US_SECRET_KEY,
    apiVersion,
    maxNetworkRetries,
    automaticTaxEnabled: env.STRIPE_US_AUTOMATIC_TAX,
    logger
  });
  const br = new StripeBillingClient({
    account: STRIPE_ACCOUNTS.BR,
    secretKey: env.STRIPE_BR_SECRET_KEY,
    apiVersion,
    maxNetworkRetries,
    automaticTaxEnabled: false,
    logger
  });

  return new StripeAccounts({
    us,
    br,
    brEnabled: env.STRIPE_BR_ENABLED,
    usWebhookSecret: env.STRIPE_US_WEBHOOK_SECRET,
    brWebhookSecret: env.STRIPE_BR_WEBHOOK_SECRET,
    nodeEnv: env.NODE_ENV,
    logger
  });
}

module.exports = {
  StripeAccounts,
  createStripeAccountsFromEnv,
  resolveStripeBilling,
  normalizeStripeAccount
};
