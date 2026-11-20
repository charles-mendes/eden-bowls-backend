const { parseRequestMarket } = require('../validators/market.validator');
const { CORRELATION_HEADER, currencyForMarket, normalizeTrailMarket } = require('../../core/purchase-trail');

// customer-purchase-trail: the store routes that write a journey step, and what each may take from the request
// or the answer. A step reads only these named fields; never the body, headers, query, pet sheet or address.
const SUBSCRIPTION_FINAL = { onOk: 'completed', onFail: 'failed' };

function termFrom(request) {
  const body = request.body || {};
  return body.subscription_term_months ?? body.term_months ?? body.termMonths;
}

function petIdFromAnswer(request, body) {
  const data = body && body.data ? body.data : {};
  return (data.pet && data.pet.id) || data.id || data.pet_id || null;
}

function stripeFieldsOf(error, body) {
  const details = (error && error.details && typeof error.details === 'object') ? error.details : {};
  return {
    stripeCode: details.stripe_code,
    stripeType: details.stripe_type,
    stripeParam: details.stripe_param
  };
}

function checkoutFields(request, body) {
  const data = body && body.data && typeof body.data === 'object' ? body.data : {};
  const reference = data.checkout_reference && typeof data.checkout_reference === 'object' ? data.checkout_reference : {};
  const pick = (key) => data[key] || reference[key] || null;
  return {
    attemptId: pick('attempt_id') || (request.body && request.body.attempt_id) || null,
    promotionCodeId: pick('promotion_code_id') || pick('stripe_promotion_code_id'),
    subscriptionId: pick('stripe_subscription_id'),
    stripeAccount: pick('stripe_account'),
    termMonths: pick('subscription_term_months')
  };
}

const ROUTES = [
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/pets\/?$/, area: 'onboarding', step: 'pet', action: 'create', fields: (request, body) => ({ petId: petIdFromAnswer(request, body) }) },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/pets\/sync\/?$/, area: 'onboarding', step: 'pet', action: 'sync' },
  { method: 'PATCH', pattern: /^\/api\/v1\/onboarding\/pets\/([^/]+)\/?$/, area: 'onboarding', step: 'pet', action: 'update', fields: (request, body, match) => ({ petId: match[1] }) },
  { method: 'DELETE', pattern: /^\/api\/v1\/onboarding\/pets\/([^/]+)\/?$/, area: 'onboarding', step: 'pet', action: 'delete', fields: (request, body, match) => ({ petId: match[1] }) },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/recommendation\/?$/, area: 'onboarding', step: 'recommendation' },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/plan\/preview\/?$/, area: 'plan', step: 'plan_preview', fields: (request) => ({ termMonths: termFrom(request) }) },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/plan\/snapshot\/?$/, area: 'plan', step: 'plan_snapshot', fields: (request) => ({ termMonths: termFrom(request) }) },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/plan-selection\/?$/, area: 'plan', step: 'plan_selection', fields: (request) => ({ termMonths: termFrom(request) }) },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/recurrence\/?$/, area: 'plan', step: 'recurrence', fields: (request) => ({ termMonths: termFrom(request) }) },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/zipcode\/lookup\/?$/, area: 'checkout', step: 'zipcode_lookup' },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/address\/?$/, area: 'checkout', step: 'address' },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/shipping\/?$/, area: 'checkout', step: 'shipping' },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/sales-tax\/quote\/?$/, area: 'checkout', step: 'sales_tax_quote' },
  { method: 'POST', pattern: /^\/api\/v1\/onboarding\/subscription\/preview\/?$/, area: 'checkout', step: 'subscription_preview', fields: (request) => ({ termMonths: termFrom(request) }) },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/onboarding\/subscription\/checkout\/?$/,
    area: 'checkout',
    step: 'subscription_checkout',
    fields: checkoutFields,
    // A validation answer (4xx) lets the customer fix and retry; the Stripe subscription failing ends the attempt.
    // A checkout reused as already paid is the server's word.
    transition: ({ ok, status, body }) => {
      if (ok) {
        return body && body.data && body.data.payment_state === 'paid' ? 'paid' : null;
      }
      return status >= 500 ? 'failed' : null;
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/onboarding\/payment-intent\/ack\/?$/,
    area: 'checkout',
    step: 'payment_intent_ack',
    fields: (request) => ({ attemptId: request.body && request.body.attempt_id }),
    transition: ({ ok }) => (ok ? 'paid' : null)
  },
  { method: 'POST', pattern: /^\/api\/v1\/subscriptions\/([^/]+)\/edit\/preview\/?$/, area: 'subscription', step: 'edit_preview', subscription: true },
  { method: 'POST', pattern: /^\/api\/v1\/subscriptions\/([^/]+)\/edit\/commit\/?$/, area: 'subscription', step: 'edit_commit', subscription: true, ...SUBSCRIPTION_FINAL },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/subscriptions\/([^/]+)\/actions\/?$/,
    area: 'subscription',
    step: 'subscription_action',
    subscription: true,
    action: (request) => request.body && request.body.action,
    ...SUBSCRIPTION_FINAL
  },
  { method: 'POST', pattern: /^\/api\/v1\/subscriptions\/([^/]+)\/deliveries\/[^/]+\/skip\/?$/, area: 'subscription', step: 'delivery_skip', subscription: true, ...SUBSCRIPTION_FINAL },
  { method: 'POST', pattern: /^\/api\/v1\/subscriptions\/([^/]+)\/deliveries\/[^/]+\/reschedule\/?$/, area: 'subscription', step: 'delivery_reschedule', subscription: true, ...SUBSCRIPTION_FINAL },
  { method: 'POST', pattern: /^\/api\/v1\/subscriptions\/([^/]+)\/deliveries\/[^/]+\/packs\/?$/, area: 'subscription', step: 'delivery_packs', subscription: true, ...SUBSCRIPTION_FINAL }
];

function matchRoute(request) {
  for (const route of ROUTES) {
    if (route.method !== request.method) {
      continue;
    }
    const match = route.pattern.exec(request.path);
    if (match) {
      return { route, match };
    }
  }
  return null;
}

// The market the page sent (X-Eden-Country / X-Eden-Domain, or country/domain in the body), if any.
function pageMarket(request) {
  const headers = request.headers || {};
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const sent = [headers['x-eden-country'], headers['x-eden-domain'], body.country, body.domain]
    .some((value) => value !== undefined && value !== null && String(value).trim() !== '');
  if (!sent) {
    return '';
  }
  try {
    return normalizeTrailMarket(parseRequestMarket(request, body));
  } catch (_error) {
    return '';
  }
}

function errorCodeOf(error, body, status) {
  const details = error && error.details && typeof error.details === 'object' ? error.details : null;
  const bodyDetails = body && body.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : null;
  if (details && details.code) return details.code;
  if (bodyDetails && bodyDetails.code) return bodyDetails.code;
  if (body && typeof body.code === 'string') return body.code;
  if (error && error.name === 'ZodError') return 'invalid_payload';
  if (status === 404) return 'not_found';
  if (status === 401) return 'unauthorized';
  if (status >= 500) return 'internal_error';
  return status >= 400 ? 'request_failed' : null;
}

function buildPurchaseTrailMiddleware(dependencies = {}) {
  return (request, response, next) => {
    const trail = dependencies.customerPurchaseTrailService;
    const matched = trail ? matchRoute(request) : null;
    if (!matched) {
      next();
      return;
    }

    let answer = null;
    const json = response.json.bind(response);
    response.json = (body) => {
      answer = body;
      return json(body);
    };

    response.on('finish', () => {
      // A request without a customer writes nothing; a token is never read here.
      const user = request.currentUser;
      if (!user || !user.id) {
        return;
      }
      const { route, match } = matched;
      const status = Number(response.statusCode);
      const ok = status >= 200 && status < 300 && !(answer && answer.success === false);
      const error = response.locals.purchaseTrailError || null;
      setImmediate(() => {
        void (async () => {
          try {
            const subscriptionId = route.subscription ? decodeURIComponent(match[1]) : null;
            const market = route.subscription
              ? await trail.resolveSubscriptionMarket(user.id, subscriptionId)
              : await trail.resolveCustomerMarket(user.id, pageMarket(request));
            if (!market) {
              return;
            }
            const fields = {
              currency: currencyForMarket(market),
              ...(route.fields ? route.fields(request, answer, match) : {}),
              ...(subscriptionId ? { subscriptionId, stripeAccount: market } : {})
            };
            let transition = null;
            if (typeof route.transition === 'function') {
              transition = route.transition({ ok, status, body: answer });
            } else if (route.onOk || route.onFail) {
              transition = ok ? route.onOk : route.onFail;
            }
            const action = typeof route.action === 'function' ? route.action(request) : route.action;
            await trail.recordStep({
              userId: user.id,
              email: user.email || user.user_email,
              market,
              correlationId: request.headers && request.headers[CORRELATION_HEADER],
              area: route.area,
              step: route.step,
              action,
              outcome: ok ? 'ok' : 'failed',
              transition,
              fields,
              error: ok ? {} : {
                httpStatus: status,
                code: errorCodeOf(error, answer, status),
                message: answer && answer.message,
                ...stripeFieldsOf(error, answer)
              }
            });
          } catch (failure) {
            if (dependencies.logger && typeof dependencies.logger.warn === 'function') {
              dependencies.logger.warn({ path: route.step, message: String(failure && failure.message || '') }, 'Purchase trail write failed.');
            }
          }
        })();
      });
    });

    next();
  };
}

// Admin changes that can stop the purchase of every customer of a market. They become a config event of that market,
// with no customer user id, next to (never instead of) the operator audit those routes already write.
const CONFIG_ROUTES = [
  { method: 'POST', pattern: /^\/api\/v1\/admin\/stripe\/first-purchase-coupons\/?$/, action: 'first_purchase_coupon.create', target: (request) => request.body && request.body.term_months && `term_${request.body.term_months}` },
  { method: 'POST', pattern: /^\/api\/v1\/admin\/stripe\/first-purchase-promos\/sync\/?$/, action: 'first_purchase_promos.sync' },
  { method: 'PUT', pattern: /^\/api\/v1\/admin\/shipping\/settings\/?$/, action: 'shipping_settings.update' },
  { method: 'POST', pattern: /^\/api\/v1\/admin\/catalog\/sync\/?$/, action: 'catalog.sync' },
  { method: 'POST', pattern: /^\/api\/v1\/admin\/catalog\/sync\/([^/]+)\/?$/, action: 'catalog.sync_product', target: (request, match) => `product_${match[1]}` },
  { method: 'POST', pattern: /^\/api\/v1\/admin\/catalog\/products\/([^/]+)\/variations\/([^/]+)\/activation\/?$/, action: 'catalog_variation.activation', target: (request, match) => `variation_${match[2]}` },
  { method: 'PUT', pattern: /^\/api\/v1\/admin\/catalog\/plan-settings\/?$/, action: 'plan_settings.update' },
  { method: 'PUT', pattern: /^\/api\/v1\/admin\/life-stage\/limits\/?$/, action: 'life_stage_limits.update' }
];

function matchConfigRoute(request) {
  for (const route of CONFIG_ROUTES) {
    const match = route.method === request.method ? route.pattern.exec(request.path) : null;
    if (match) {
      return { route, match };
    }
  }
  return null;
}

// The market of the account changed: named in the request (account, stripe_account, market), the single market of
// the staff query, or the plan country of the answered product. A change that spans the staff's markets is one event
// per market; with none resolvable nothing is written.
function configMarkets(request, answer) {
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const query = request.query || {};
  const data = answer && typeof answer === 'object' ? (answer.data && typeof answer.data === 'object' ? answer.data : answer) : {};
  const named = [body.account, body.stripe_account, body.market, query.account, query.stripe_account, query.market, data.planCountry, data.plan_country, data.stripe_account]
    .map((value) => normalizeTrailMarket(value))
    .find(Boolean);
  if (named) {
    return [named];
  }
  const scoped = request.marketQuery || {};
  if (scoped.market) {
    return [normalizeTrailMarket(scoped.market)].filter(Boolean);
  }
  return (Array.isArray(scoped.markets) ? scoped.markets : []).map((value) => normalizeTrailMarket(value)).filter(Boolean);
}

function buildPurchaseTrailConfigMiddleware(dependencies = {}) {
  return (request, response, next) => {
    const trail = dependencies.customerPurchaseTrailService;
    const matched = trail ? matchConfigRoute(request) : null;
    if (!matched) {
      next();
      return;
    }
    let answer = null;
    const json = response.json.bind(response);
    response.json = (body) => {
      answer = body;
      return json(body);
    };
    response.on('finish', () => {
      // Only a change by an operator who passed the permission check: a refused token changed nothing.
      const identity = request.adminIdentity;
      if (!identity) {
        return;
      }
      const status = Number(response.statusCode);
      const ok = status >= 200 && status < 300 && !(answer && answer.success === false);
      const error = response.locals.purchaseTrailError || null;
      const { route, match } = matched;
      setImmediate(() => {
        for (const market of configMarkets(request, answer)) {
          void trail.recordConfig({
            market,
            actorId: identity.userId || identity.id || (request.currentUser && request.currentUser.id),
            action: route.action,
            targetRef: route.target ? route.target(request, match) : null,
            outcome: ok ? 'ok' : 'failed',
            errorCode: ok ? null : errorCodeOf(error, answer, status)
          });
        }
      });
    });
    next();
  };
}

module.exports = {
  buildPurchaseTrailMiddleware,
  buildPurchaseTrailConfigMiddleware,
  configMarkets,
  PURCHASE_TRAIL_ROUTES: ROUTES,
  matchPurchaseTrailRoute: matchRoute,
  pageMarket,
  errorCodeOf
};
