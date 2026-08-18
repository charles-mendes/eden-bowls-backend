const { HttpError } = require('../../core/http-error');
const { collectPriceItems } = require('../../core/checkout-state');
const { discountAmountFromSubtotal } = require('../../core/first-purchase-discount');

function parseJsonColumn(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return null;
  }
}

class OnboardingSubscriptionCheckoutRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
    this.petsTableName = options.petsTableName || 'onboarding_pets';
    this.postmetaTableName = options.postmetaTableName || 'wp_postmeta';
    this.usersTableName = options.usersTableName || 'wp_users';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async getPlanSelection(userId) {
    this.ensureDataSource();

    const rows = await this.dataSource.query(
      `SELECT \`plan_selection\` FROM \`${this.tableName}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return parseJsonColumn(row && row.plan_selection);
  }

  async getCheckoutContext(userId) {
    this.ensureDataSource();

    const stateRows = await this.dataSource.query(
      `SELECT \`plan_selection\`, \`address\`, \`shipping\`, \`recurrence\`, \`checkout_reference\` FROM \`${this.tableName}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const state = Array.isArray(stateRows) ? stateRows[0] : null;
    let pets = [];

    try {
      const petRows = await this.dataSource.query(
        `SELECT \`id\` FROM \`${this.petsTableName}\` WHERE \`user_id\` = ? AND \`deleted_at\` IS NULL`,
        [userId]
      );
      pets = Array.isArray(petRows) ? petRows : [];
    } catch (_error) {
      pets = [];
    }

    return {
      pets,
      planSelection: parseJsonColumn(state && state.plan_selection),
      address: parseJsonColumn(state && state.address),
      shipping: parseJsonColumn(state && state.shipping),
      recurrence: parseJsonColumn(state && state.recurrence),
      checkoutReference: parseJsonColumn(state && state.checkout_reference)
    };
  }

  async getUserEmail(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT \`user_email\`, \`display_name\` FROM \`${this.usersTableName}\` WHERE \`ID\` = ? LIMIT 1`,
      [userId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return {
      email: row ? String(row.user_email || '') : '',
      name: row ? String(row.display_name || '') : ''
    };
  }

  async resolveSubscriptionItems(planSelection) {
    const collected = collectPriceItems(planSelection || {});
    const unresolved = collected.filter((item) => !String(item.price || '').startsWith('price_') && item.variation_id);
    const currency = String(
      (planSelection && planSelection.catalog_pricing && planSelection.catalog_pricing.currency)
      || planSelection && planSelection.currency
      || 'USD'
    ).toLowerCase();

    if (unresolved.length > 0) {
      const byVariation = await this.lookupStripePrices(
        unresolved.map((item) => item.variation_id),
        currency
      );
      for (const item of collected) {
        if (!String(item.price || '').startsWith('price_') && item.variation_id) {
          item.price = byVariation.get(Number(item.variation_id)) || '';
        }
      }
    }

    const merged = new Map();
    for (const item of collected) {
      if (!String(item.price || '').startsWith('price_')) {
        continue;
      }
      const current = merged.get(item.price) || { price: item.price, quantity: 0 };
      current.quantity += Math.max(1, Number(item.quantity) || 1);
      merged.set(item.price, current);
    }

    return Array.from(merged.values());
  }

  async lookupStripePrices(variationIds, currency) {
    const ids = [...new Set(variationIds.map(Number).filter((id) => id > 0))];
    const map = new Map();
    if (ids.length === 0 || !this.dataSource || !this.dataSource.isInitialized) {
      return map;
    }

    const placeholders = ids.map(() => '?').join(', ');
    let rows = [];
    try {
      rows = await this.dataSource.query(
        `SELECT \`post_id\`, \`meta_key\`, \`meta_value\` FROM \`${this.postmetaTableName}\` WHERE \`post_id\` IN (${placeholders}) AND \`meta_key\` IN ('_stripe_price_id', '_stripe_price_ids_by_currency')`,
        ids
      );
    } catch (_error) {
      return map;
    }

    const byPost = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const postId = Number(row.post_id);
      if (!byPost.has(postId)) {
        byPost.set(postId, {});
      }
      byPost.get(postId)[row.meta_key] = row.meta_value;
    }

    for (const [postId, meta] of byPost.entries()) {
      let priceId = '';
      const byCurrencyRaw = String(meta._stripe_price_ids_by_currency || '').trim();
      if (byCurrencyRaw) {
        try {
          const byCurrency = JSON.parse(byCurrencyRaw);
          const candidate = byCurrency && byCurrency[currency];
          if (typeof candidate === 'string' && candidate.startsWith('price_')) {
            priceId = candidate;
          }
        } catch (_error) {
          priceId = '';
        }
      }
      if (!priceId) {
        const fallback = String(meta._stripe_price_id || '').trim();
        if (fallback.startsWith('price_')) {
          priceId = fallback;
        }
      }
      if (priceId) {
        map.set(postId, priceId);
      }
    }

    return map;
  }

  async checkout(userId, payload = {}) {
    this.ensureDataSource();

    const checkout = payload.checkout || this.buildFallbackCheckout(payload);
    const planSelection = payload.plan_selection || null;

    if (planSelection) {
      await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\` (\`user_id\`, \`checkout_reference\`, \`plan_selection\`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE \`checkout_reference\` = VALUES(\`checkout_reference\`), \`plan_selection\` = VALUES(\`plan_selection\`)`,
        [userId, JSON.stringify(checkout), JSON.stringify(planSelection)]
      );
    } else {
      await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\` (\`user_id\`, \`checkout_reference\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`checkout_reference\` = VALUES(\`checkout_reference\`)`,
        [userId, JSON.stringify(checkout)]
      );
    }

    return checkout;
  }

  buildFallbackCheckout(payload = {}) {
    const billing = payload.billing || {};
    const paymentMethodId = payload.payment_method_id || payload.paymentMethodId || '';
    const appliedPercent = Number(payload.discount_applied_percent) || 0;
    const promotionCodeId = payload.stripe_promotion_code_id || null;
    const catalog = payload.plan_selection && payload.plan_selection.catalog_pricing
      ? payload.plan_selection.catalog_pricing
      : {};
    const shipping = payload.shipping || {};
    const subtotal = Number(catalog.subtotal);
    const resolvedSubtotal = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;
    const shippingTotal = Number(shipping.cost || shipping.total || 0);
    const productTax = Number(payload.product_tax || 0);
    const total = Number((
      Number(catalog.discounted_first_month_total != null ? catalog.discounted_first_month_total : resolvedSubtotal)
      + shippingTotal
      + productTax
    ).toFixed(2));

    return {
      order_id: Date.now(),
      order_key: 'pending',
      status: 'pending',
      total,
      subtotal: resolvedSubtotal,
      product_tax: productTax,
      shipping_total: shippingTotal,
      shipping_tax: 0,
      shipping_total_with_tax: shippingTotal,
      currency: String(catalog.currency || payload.currency || 'USD').toUpperCase(),
      payment_url: undefined,
      subscription_ids: [],
      flexible_subscription_id: 0,
      stripe_subscription_id: undefined,
      payment_state: paymentMethodId ? 'requires_confirmation' : 'pending_payment_method',
      has_payment_method: Boolean(paymentMethodId),
      reused: false,
      billing: {
        first_name: billing.first_name || '',
        last_name: billing.last_name || '',
        email: billing.email || '',
        phone: billing.phone || '',
        company: billing.company || ''
      },
      checkout_mode: payload.checkout_mode || payload.flow || 'order_first',
      discount_eligibility: payload.discount_eligibility || null,
      discount_applied_percent: appliedPercent,
      stripe_promotion_code_id: promotionCodeId,
      stripe_coupon_id: payload.stripe_coupon_id || null,
      stripe_discount_percent: appliedPercent,
      stripe_discount_amount: discountAmountFromSubtotal(resolvedSubtotal, appliedPercent),
      stripe_discount_duration: payload.stripe_discount_duration || null,
      discounts: promotionCodeId ? [{ promotion_code: promotionCodeId }] : []
    };
  }
}

module.exports = {
  OnboardingSubscriptionCheckoutRepository
};
