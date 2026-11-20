const MARKETS = ['BR', 'US'];
const CATALOG_WARNINGS = {
  never_synced: 'catalog_never_synced',
  account_changed: 'catalog_account_changed',
  prices_missing: 'catalog_prices_missing'
};

// What would make store checkout fail in Brazil or in the United States right now (admin-checkout-readiness). Read
// only: it never writes to Stripe or UPS, and the response carries booleans about keys and credentials, never a value.
// A check that cannot reach Stripe or UPS becomes a note, not a warning.
class AdminCheckoutReadinessService {
  constructor(options = {}) {
    this.adminCatalogService = options.adminCatalogService || null;
    this.stripeCouponService = options.stripeCouponService || null;
    this.shippingService = options.shippingService || null;
    this.stripeBrEnabled = Boolean(options.stripeBrEnabled);
    const present = options.stripeSecretKeyPresent || {};
    this.stripeSecretKeyPresent = { BR: Boolean(present.BR), US: Boolean(present.US) };
    this.logger = options.logger || null;
    this.now = options.now || (() => new Date());
  }

  async read() {
    const warnings = [];
    const notes = [];

    for (const market of MARKETS) {
      if (!this.stripeSecretKeyPresent[market]) {
        warnings.push(warning(`secret_key:${market}`, 'stripe_secret_key_missing', market, null));
        continue;
      }
      if (market === 'BR' && !this.stripeBrEnabled) {
        warnings.push(warning('stripe_br_disabled:BR', 'stripe_br_disabled', 'BR', null));
        continue;
      }
      await this.checkCatalog(market, warnings, notes);
      await this.checkCoupons(market, warnings, notes);
    }

    const shipping = await this.checkUsShipping(warnings, notes);
    this.checkBrCenter(warnings);

    return {
      checked_at: this.now().toISOString(),
      config: {
        stripe_br_enabled: this.stripeBrEnabled,
        stripe_secret_key_present: { ...this.stripeSecretKeyPresent },
        ups_configured: shipping.upsConfigured
      },
      warnings,
      notes: dedupe(notes)
    };
  }

  async checkCatalog(market, warnings, notes) {
    if (!this.adminCatalogService) {
      return;
    }
    let account;
    try {
      const health = await this.adminCatalogService.health({ market, currency: market === 'US' ? 'USD' : 'BRL' }, {});
      account = health && health.stripe_account;
    } catch (error) {
      this.warn(error, market, 'catalog');
      notes.push(note(`stripe:${market}`, 'stripe_unverified', market));
      return;
    }
    const status = account && account.status;
    if (CATALOG_WARNINGS[status]) {
      const details = status === 'prices_missing' ? { missing_variation_ids: account.missing_variation_ids || [] } : {};
      warnings.push(warning(`catalog:${market}`, CATALOG_WARNINGS[status], market, 'products', details));
    } else if (status === 'unverified') {
      notes.push(note(`stripe:${market}`, 'stripe_unverified', market));
    }
  }

  async checkCoupons(market, warnings, notes) {
    if (!this.stripeCouponService) {
      return;
    }
    let readiness;
    try {
      readiness = await this.stripeCouponService.checkoutReadiness(market.toLowerCase());
    } catch (error) {
      this.warn(error, market, 'coupons');
      notes.push(note(`stripe:${market}`, 'stripe_unverified', market));
      return;
    }
    if (readiness.missing_terms && readiness.missing_terms.length) {
      // Only checkouts of those terms are refused, so this one is medium.
      warnings.push(warning(`coupon:${market}`, 'coupon_missing', market, 'coupons', { terms: readiness.missing_terms }, 'medium'));
    }
    if (readiness.unverified) {
      notes.push(note(`stripe:${market}`, 'stripe_unverified', market));
    }
  }

  async checkUsShipping(warnings, notes) {
    if (!this.shippingService) {
      return { upsConfigured: false };
    }
    let readiness;
    try {
      readiness = await this.shippingService.usCheckoutReadiness();
    } catch (error) {
      this.warn(error, 'US', 'shipping');
      notes.push(note('ups:US', 'ups_unverified', 'US'));
      return { upsConfigured: false };
    }
    const action = 'shipping_us';
    if (readiness.code) {
      warnings.push(warning('shipping:US', readiness.code, 'US', action));
    } else if (readiness.unverified) {
      notes.push(note('ups:US', 'ups_unverified', 'US'));
    }
    return { upsConfigured: Boolean(readiness.ups_configured) };
  }

  checkBrCenter(warnings) {
    const settings = this.shippingService && this.shippingService.settings;
    const center = (settings && settings.br && settings.br.center) || {};
    const lat = Number(center.lat);
    const lng = Number(center.lng);
    const missing = !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0);
    if (missing) {
      warnings.push(warning('center:BR', 'br_center_missing', 'BR', 'shipping_br'));
    }
  }

  warn(error, market, check) {
    if (this.logger) {
      this.logger.warn({ err: error, market, check }, 'Checkout readiness check could not run.');
    }
  }
}

function warning(key, code, market, action, details = {}, severity = 'high') {
  return { key, code, market, severity, action, details };
}

function note(key, code, market) {
  return { key, code, market };
}

function dedupe(notes) {
  const seen = new Set();
  return notes.filter((item) => (seen.has(item.key) ? false : seen.add(item.key)));
}

module.exports = {
  AdminCheckoutReadinessService
};
