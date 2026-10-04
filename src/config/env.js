const dotenv = require('dotenv');
const { z } = require('zod');
const { effectiveOtpTtlSeconds } = require('../core/otp-email');

dotenv.config();

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SENTRY_DSN: z.string().optional(),
  PORT: z.string().default('3000'),
  MODE: z.enum(['all', 'http', 'cron', 'worker']).default('http'),
  ENABLE_BACKGROUND_JOBS: z.string().optional(),
  PRIME_ENABLE_UPDATE: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:5175'),
  ADMIN_EMAILS: z.string().optional(),
  ADMIN_ENFORCE_STAFF_MARKET: z.string().optional(),
  ADMIN_APP_URL: z.string().optional(),
  STORE_APP_URL: z.string().optional(),
  MAIL_OPS_TO: z.string().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().default('3306'),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default('root'),
  DB_NAME: z.string().default('eden_bowls'),
  JWT_AUTH_SECRET_KEY: z.string().optional(),
  JWT_AUTH_ALGORITHM: z.string().default('HS256'),
  JWT_AUTH_EXPIRES_IN_SECONDS: z.string().default('900'),
  JWT_AUTH_ISSUER: z.string().default('http://localhost:3000'),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: z.string().default('2592000'),
  AUTH_REFRESH_COOKIE_NAME: z.string().default('eden_refresh_token'),
  AUTH_REFRESH_COOKIE_PATH: z.string().default('/api/v1/auth'),
  AUTH_REFRESH_COOKIE_DOMAIN: z.string().optional(),
  AUTH_REFRESH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  AUTH_REFRESH_COOKIE_SECURE: z.string().optional(),
  AUTH_OTP_TTL_SECONDS: z.string().default('600'),
  AUTH_OTP_MAX_ATTEMPTS: z.string().default('5'),
  AUTH_OTP_PEPPER: z.string().optional(),
  AUTH_OTP_RESEND_MAX_ATTEMPTS: z.string().default('3'),
  AUTH_OTP_RESEND_WINDOW_SECONDS: z.string().default('3600'),
  AUTH_SMTP_HOST: z.string().optional(),
  AUTH_SMTP_PORT: z.string().optional(),
  AUTH_SMTP_USER: z.string().optional(),
  AUTH_SMTP_PASS: z.string().optional(),
  AUTH_SMTP_ENCRYPTION: z.string().optional(),
  AUTH_SMTP_AUTH: z.string().optional(),
  AUTH_MAIL_FROM: z.string().optional(),
  AUTH_MAIL_FROM_NAME: z.string().optional(),
  HSR_SMTP_HOST: z.string().optional(),
  HSR_SMTP_PORT: z.string().optional(),
  HSR_SMTP_USER: z.string().optional(),
  HSR_SMTP_PASS: z.string().optional(),
  HSR_SMTP_ENCRYPTION: z.string().optional(),
  HSR_SMTP_AUTH: z.string().optional(),
  HSR_MAIL_FROM: z.string().optional(),
  HSR_MAIL_FROM_NAME: z.string().optional(),
  HSR_ACTIVATION_TTL: z.string().optional(),
  AUTH_SALT: z.string().optional(),
  BREEDS_TABLE_NAME: z.string().default('wp_hsr_breeds'),
  PRICE_ZONE_POLICY_TABLE_NAME: z.string().default('price_zone_policy'),
  WP_USERS_TABLE_NAME: z.string().default('wp_users'),
  WP_USERMETA_TABLE_NAME: z.string().default('wp_usermeta'),
  WP_POSTS_TABLE_NAME: z.string().default('wp_posts'),
  WP_POSTMETA_TABLE_NAME: z.string().default('wp_postmeta'),
  WP_TERMS_TABLE_NAME: z.string().default('wp_terms'),
  WP_TERM_TAXONOMY_TABLE_NAME: z.string().default('wp_term_taxonomy'),
  WP_TERM_RELATIONSHIPS_TABLE_NAME: z.string().default('wp_term_relationships'),
  WP_HSR_STRIPE_SUBSCRIPTIONS_TABLE_NAME: z.string().default('wp_hsr_stripe_subscriptions'),
  STRIPE_BR_SECRET_KEY: z.string().optional(),
  STRIPE_US_SECRET_KEY: z.string().optional(),
  STRIPE_API_VERSION: z.string().optional(),
  STRIPE_MAX_RETRIES: z.string().optional(),
  STRIPE_US_AUTOMATIC_TAX: z.string().optional(),
  STRIPE_BR_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_US_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_BR_ENABLED: z.string().optional(),
  EDEN_RUNTIME: z.string().optional(),
  NOMINATIM_USER_AGENT: z.string().optional(),
  GEO_MAXMIND_DB_PATH: z.string().default('./data/GeoLite2-Country.mmdb'),
  GEO_TRUST_PROXY_HEADERS: z.string().optional(),
  TRUST_PROXY: z.string().optional(),
  PROFILE_AVATAR_DIR: z.string().optional(),
  PROFILE_AVATAR_PUBLIC_BASE_URL: z.string().optional(),
  FEEDBACK_PHOTO_DIR: z.string().optional(),
  FEEDBACK_PHOTO_PUBLIC_BASE_URL: z.string().optional(),
  PET_PHOTO_DIR: z.string().optional(),
  PET_PHOTO_PUBLIC_BASE_URL: z.string().optional(),
  UPS_CLIENT_ID: z.string().optional(),
  UPS_CLIENT_SECRET: z.string().optional(),
  UPS_ACCOUNT_NUMBER: z.string().optional(),
  UPS_ENV: z.string().optional(),
  UPS_HTTP_TIMEOUT_MS: z.string().optional(),
  UPS_TRANSACTION_SRC: z.string().optional(),
  UPS_LABEL_DIR: z.string().optional(),
  SHIPPING_QUOTE_SECRET: z.string().optional(),
  SHIPPING_US_FIXED_TRANSIT_DAYS: z.string().optional(),
  METRICS_TOKEN: z.string().optional()
});

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

const FORBIDDEN_SECRET_VALUES = new Set(['change-this-in-production', 'hsr-default-salt']);

function isRejectedSecret(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length === 0 || FORBIDDEN_SECRET_VALUES.has(normalized);
}

function requireProductionSecret(label, value) {
  if (isRejectedSecret(value)) {
    throw new Error(`${label} must be set to a non-placeholder value in production.`);
  }
}

function hostnameOfOrigin(origin) {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isEdenbowlsComBrHost(hostname) {
  return hostname === 'edenbowls.com.br' || hostname.endsWith('.edenbowls.com.br');
}

function isEdenbowlsComHost(hostname) {
  if (isEdenbowlsComBrHost(hostname)) {
    return false;
  }
  return hostname === 'edenbowls.com' || hostname.endsWith('.edenbowls.com');
}

function assertProductionEnv(rawEnv, resolved) {
  if (rawEnv.NODE_ENV !== 'production') {
    return;
  }

  requireProductionSecret('JWT_AUTH_SECRET_KEY', resolved.JWT_AUTH_SECRET_KEY);
  requireProductionSecret('AUTH_OTP_PEPPER', firstNonEmpty(rawEnv.AUTH_OTP_PEPPER, rawEnv.AUTH_SALT));
  requireProductionSecret('AUTH_SMTP_HOST', resolved.AUTH_SMTP_HOST);
  requireProductionSecret('AUTH_MAIL_FROM', resolved.AUTH_MAIL_FROM);
  requireProductionSecret('STRIPE_US_SECRET_KEY', resolved.STRIPE_US_SECRET_KEY);
  requireProductionSecret('STRIPE_US_WEBHOOK_SECRET', resolved.STRIPE_US_WEBHOOK_SECRET);
  requireProductionSecret('STRIPE_BR_SECRET_KEY', resolved.STRIPE_BR_SECRET_KEY);
  requireProductionSecret('STRIPE_BR_WEBHOOK_SECRET', resolved.STRIPE_BR_WEBHOOK_SECRET);
  requireProductionSecret('UPS_CLIENT_ID', resolved.UPS_CLIENT_ID);
  requireProductionSecret('UPS_CLIENT_SECRET', resolved.UPS_CLIENT_SECRET);
  requireProductionSecret('UPS_ACCOUNT_NUMBER', resolved.UPS_ACCOUNT_NUMBER);
  requireProductionSecret('METRICS_TOKEN', resolved.METRICS_TOKEN);
  requireProductionSecret('DB_PASSWORD', resolved.DB_PASSWORD);

  const stripeBrFlag = String(rawEnv.STRIPE_BR_ENABLED ?? '').trim().toLowerCase();
  if (stripeBrFlag !== 'true' && stripeBrFlag !== 'false') {
    throw new Error('STRIPE_BR_ENABLED must be true or false in production.');
  }

  let issuer;
  try {
    issuer = new URL(String(rawEnv.JWT_AUTH_ISSUER || '').trim());
  } catch {
    throw new Error('JWT_AUTH_ISSUER must be an https URL in production.');
  }
  if (issuer.protocol !== 'https:' || issuer.hostname === 'localhost') {
    throw new Error('JWT_AUTH_ISSUER must be an https URL and must not use localhost in production.');
  }

  const upsEnv = String(rawEnv.UPS_ENV ?? '').trim();
  if (upsEnv !== 'production' && upsEnv !== 'cie') {
    throw new Error('UPS_ENV must be production or cie in production.');
  }

  if (String(rawEnv.AUTH_REFRESH_COOKIE_DOMAIN || '').trim()) {
    throw new Error('AUTH_REFRESH_COOKIE_DOMAIN must be empty in production.');
  }

  if (resolved.CORS_ORIGINS.length === 0) {
    throw new Error('CORS_ORIGINS must list https origins in production.');
  }

  for (const origin of resolved.CORS_ORIGINS) {
    const hostname = hostnameOfOrigin(origin);
    if (!origin.startsWith('https://') || origin.includes('localhost') || hostname === 'localhost') {
      throw new Error('CORS_ORIGINS must use https and must not include localhost in production.');
    }
  }

  const hosts = resolved.CORS_ORIGINS.map(hostnameOfOrigin);
  const hasCom = hosts.some(isEdenbowlsComHost);
  const hasComBr = hosts.some(isEdenbowlsComBrHost);
  if (hasCom && hasComBr && rawEnv.AUTH_REFRESH_COOKIE_SAME_SITE !== 'none') {
    throw new Error('AUTH_REFRESH_COOKIE_SAME_SITE must be none when CORS_ORIGINS includes both edenbowls.com and edenbowls.com.br.');
  }
}

const LOCAL_SHIPPING_QUOTE_SECRET = 'eden-local-shipping-quote';

function assertShippingQuoteSecret(rawEnv, resolved) {
  if (String(rawEnv.EDEN_RUNTIME || '').trim() !== 'production') {
    return;
  }
  const secret = resolved.SHIPPING_QUOTE_SECRET;
  if (isRejectedSecret(secret) || secret === LOCAL_SHIPPING_QUOTE_SECRET) {
    throw new Error('SHIPPING_QUOTE_SECRET must be set to a non-placeholder value in production.');
  }
  if (secret === resolved.JWT_AUTH_SECRET_KEY) {
    throw new Error('SHIPPING_QUOTE_SECRET must differ from JWT_AUTH_SECRET_KEY in production.');
  }
}

const EDEN_RUNTIMES = new Set(['local', 'qa', 'production']);

function assertEdenRuntime(rawEnv) {
  const value = String(rawEnv.EDEN_RUNTIME || '').trim();
  if (!EDEN_RUNTIMES.has(value)) {
    throw new Error('EDEN_RUNTIME must be local, qa, or production.');
  }
}

function parseEnv(source = process.env) {
  const rawEnv = rawEnvSchema.parse(source);
  assertEdenRuntime(rawEnv);
  const refreshCookieSecure = toBoolean(rawEnv.AUTH_REFRESH_COOKIE_SECURE, rawEnv.NODE_ENV === 'production');

  if (rawEnv.NODE_ENV === 'production' && !refreshCookieSecure) {
    throw new Error('AUTH_REFRESH_COOKIE_SECURE must be enabled in production.');
  }

  if (rawEnv.AUTH_REFRESH_COOKIE_SAME_SITE === 'none' && !refreshCookieSecure) {
    throw new Error('AUTH_REFRESH_COOKIE_SAME_SITE=none requires AUTH_REFRESH_COOKIE_SECURE.');
  }

  const corsOrigins = String(rawEnv.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const smtpAuthRaw = firstNonEmpty(rawEnv.AUTH_SMTP_AUTH, rawEnv.HSR_SMTP_AUTH);

  const resolved = {
    NODE_ENV: rawEnv.NODE_ENV,
    SENTRY_DSN: String(rawEnv.SENTRY_DSN || '').trim(),
    EDEN_RUNTIME: String(rawEnv.EDEN_RUNTIME || '').trim(),
    PORT: Number(rawEnv.PORT),
    MODE: rawEnv.MODE,
    ENABLE_BACKGROUND_JOBS: toBoolean(rawEnv.ENABLE_BACKGROUND_JOBS),
    PRIME_ENABLE_UPDATE: toBoolean(rawEnv.PRIME_ENABLE_UPDATE),
    LOG_LEVEL: rawEnv.LOG_LEVEL || (rawEnv.NODE_ENV === 'development' ? 'debug' : 'info'),
    CORS_ORIGINS: corsOrigins,
    ADMIN_EMAILS: String(rawEnv.ADMIN_EMAILS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    ADMIN_ENFORCE_STAFF_MARKET: toBoolean(rawEnv.ADMIN_ENFORCE_STAFF_MARKET, false),
    ADMIN_APP_URL: firstNonEmpty(rawEnv.ADMIN_APP_URL, 'http://localhost:5174'),
    STORE_APP_URL: firstNonEmpty(rawEnv.STORE_APP_URL, 'http://localhost:5173'),
    EMAIL_ASSET_BASE_URL: firstNonEmpty(rawEnv.EMAIL_ASSET_BASE_URL) || '',
    MAIL_OPS_TO: String(rawEnv.MAIL_OPS_TO || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    DB_HOST: rawEnv.DB_HOST,
    DB_PORT: Number(rawEnv.DB_PORT),
    DB_USER: rawEnv.DB_USER,
    DB_PASSWORD: rawEnv.DB_PASSWORD,
    DB_NAME: rawEnv.DB_NAME,
    JWT_AUTH_SECRET_KEY: rawEnv.JWT_AUTH_SECRET_KEY || '',
    JWT_AUTH_ALGORITHM: rawEnv.JWT_AUTH_ALGORITHM,
    JWT_AUTH_EXPIRES_IN_SECONDS: Number(rawEnv.JWT_AUTH_EXPIRES_IN_SECONDS),
    JWT_AUTH_ISSUER: rawEnv.JWT_AUTH_ISSUER,
    AUTH_REFRESH_TOKEN_TTL_SECONDS: Number(rawEnv.AUTH_REFRESH_TOKEN_TTL_SECONDS),
    AUTH_REFRESH_COOKIE_NAME: rawEnv.AUTH_REFRESH_COOKIE_NAME,
    AUTH_REFRESH_COOKIE_PATH: rawEnv.AUTH_REFRESH_COOKIE_PATH,
    AUTH_REFRESH_COOKIE_DOMAIN: rawEnv.AUTH_REFRESH_COOKIE_DOMAIN || '',
    AUTH_REFRESH_COOKIE_SAME_SITE: rawEnv.AUTH_REFRESH_COOKIE_SAME_SITE,
    AUTH_REFRESH_COOKIE_SECURE: refreshCookieSecure,
    AUTH_OTP_TTL_SECONDS: effectiveOtpTtlSeconds(firstNonEmpty(rawEnv.HSR_ACTIVATION_TTL, rawEnv.AUTH_OTP_TTL_SECONDS)),
    AUTH_OTP_MAX_ATTEMPTS: Number(rawEnv.AUTH_OTP_MAX_ATTEMPTS),
    AUTH_OTP_PEPPER: firstNonEmpty(rawEnv.AUTH_OTP_PEPPER, rawEnv.AUTH_SALT, rawEnv.JWT_AUTH_SECRET_KEY) || 'hsr-default-salt',
    AUTH_OTP_RESEND_MAX_ATTEMPTS: Number(rawEnv.AUTH_OTP_RESEND_MAX_ATTEMPTS),
    AUTH_OTP_RESEND_WINDOW_SECONDS: Number(rawEnv.AUTH_OTP_RESEND_WINDOW_SECONDS),
    AUTH_SMTP_HOST: firstNonEmpty(rawEnv.AUTH_SMTP_HOST, rawEnv.HSR_SMTP_HOST),
    AUTH_SMTP_PORT: Number(firstNonEmpty(rawEnv.AUTH_SMTP_PORT, rawEnv.HSR_SMTP_PORT, '587')),
    AUTH_SMTP_USER: firstNonEmpty(rawEnv.AUTH_SMTP_USER, rawEnv.HSR_SMTP_USER),
    AUTH_SMTP_PASS: firstNonEmpty(rawEnv.AUTH_SMTP_PASS, rawEnv.HSR_SMTP_PASS),
    AUTH_SMTP_ENCRYPTION: firstNonEmpty(rawEnv.AUTH_SMTP_ENCRYPTION, rawEnv.HSR_SMTP_ENCRYPTION, 'tls'),
    AUTH_SMTP_AUTH: smtpAuthRaw === '' ? true : toBoolean(smtpAuthRaw, true),
    AUTH_MAIL_FROM: firstNonEmpty(rawEnv.AUTH_MAIL_FROM, rawEnv.HSR_MAIL_FROM),
    AUTH_MAIL_FROM_NAME: firstNonEmpty(rawEnv.AUTH_MAIL_FROM_NAME, rawEnv.HSR_MAIL_FROM_NAME, 'Eden Bowls'),
    BREEDS_TABLE_NAME: rawEnv.BREEDS_TABLE_NAME,
    PRICE_ZONE_POLICY_TABLE_NAME: rawEnv.PRICE_ZONE_POLICY_TABLE_NAME,
    WP_USERS_TABLE_NAME: rawEnv.WP_USERS_TABLE_NAME,
    WP_USERMETA_TABLE_NAME: rawEnv.WP_USERMETA_TABLE_NAME,
    WP_POSTS_TABLE_NAME: rawEnv.WP_POSTS_TABLE_NAME,
    WP_POSTMETA_TABLE_NAME: rawEnv.WP_POSTMETA_TABLE_NAME,
    WP_TERMS_TABLE_NAME: rawEnv.WP_TERMS_TABLE_NAME,
    WP_TERM_TAXONOMY_TABLE_NAME: rawEnv.WP_TERM_TAXONOMY_TABLE_NAME,
    WP_TERM_RELATIONSHIPS_TABLE_NAME: rawEnv.WP_TERM_RELATIONSHIPS_TABLE_NAME,
    WP_HSR_STRIPE_SUBSCRIPTIONS_TABLE_NAME: rawEnv.WP_HSR_STRIPE_SUBSCRIPTIONS_TABLE_NAME,
    STRIPE_BR_SECRET_KEY: firstNonEmpty(rawEnv.STRIPE_BR_SECRET_KEY),
    STRIPE_US_SECRET_KEY: firstNonEmpty(rawEnv.STRIPE_US_SECRET_KEY),
    STRIPE_API_VERSION: firstNonEmpty(rawEnv.STRIPE_API_VERSION, '2025-09-30.clover'),
    STRIPE_MAX_RETRIES: Number(firstNonEmpty(rawEnv.STRIPE_MAX_RETRIES, '2')),
    STRIPE_US_AUTOMATIC_TAX: toBoolean(rawEnv.STRIPE_US_AUTOMATIC_TAX, true),
    STRIPE_BR_WEBHOOK_SECRET: firstNonEmpty(rawEnv.STRIPE_BR_WEBHOOK_SECRET),
    STRIPE_US_WEBHOOK_SECRET: firstNonEmpty(rawEnv.STRIPE_US_WEBHOOK_SECRET),
    STRIPE_BR_ENABLED: toBoolean(rawEnv.STRIPE_BR_ENABLED, false),
    NOMINATIM_USER_AGENT: firstNonEmpty(rawEnv.NOMINATIM_USER_AGENT) || 'EdenBowlShipping/1.0 (https://edenbowl.com; shipping@edenbowl.com)',
    GEO_MAXMIND_DB_PATH: firstNonEmpty(rawEnv.GEO_MAXMIND_DB_PATH) || './data/GeoLite2-Country.mmdb',
    GEO_TRUST_PROXY_HEADERS: toBoolean(rawEnv.GEO_TRUST_PROXY_HEADERS, false),
    TRUST_PROXY: toBoolean(rawEnv.TRUST_PROXY, toBoolean(rawEnv.GEO_TRUST_PROXY_HEADERS, rawEnv.NODE_ENV === 'production')),
    PROFILE_AVATAR_DIR: firstNonEmpty(rawEnv.PROFILE_AVATAR_DIR) || './public/avatars',
    PROFILE_AVATAR_PUBLIC_BASE_URL: firstNonEmpty(rawEnv.PROFILE_AVATAR_PUBLIC_BASE_URL),
    FEEDBACK_PHOTO_DIR: firstNonEmpty(rawEnv.FEEDBACK_PHOTO_DIR) || './public/feedback-photos',
    FEEDBACK_PHOTO_PUBLIC_BASE_URL: firstNonEmpty(rawEnv.FEEDBACK_PHOTO_PUBLIC_BASE_URL),
    PET_PHOTO_DIR: firstNonEmpty(rawEnv.PET_PHOTO_DIR) || './public/pet-photos',
    PET_PHOTO_PUBLIC_BASE_URL: firstNonEmpty(rawEnv.PET_PHOTO_PUBLIC_BASE_URL),
    UPS_CLIENT_ID: firstNonEmpty(rawEnv.UPS_CLIENT_ID),
    UPS_CLIENT_SECRET: firstNonEmpty(rawEnv.UPS_CLIENT_SECRET),
    UPS_ACCOUNT_NUMBER: firstNonEmpty(rawEnv.UPS_ACCOUNT_NUMBER),
    UPS_ENV: rawEnv.NODE_ENV === 'production'
      ? String(rawEnv.UPS_ENV ?? '').trim()
      : firstNonEmpty(rawEnv.UPS_ENV, 'cie'),
    UPS_HTTP_TIMEOUT_MS: Number(firstNonEmpty(rawEnv.UPS_HTTP_TIMEOUT_MS, '5000')),
    UPS_TRANSACTION_SRC: firstNonEmpty(rawEnv.UPS_TRANSACTION_SRC, 'eden-bowls'),
    UPS_LABEL_DIR: firstNonEmpty(rawEnv.UPS_LABEL_DIR) || './data/ups-labels',
    SHIPPING_QUOTE_SECRET: firstNonEmpty(rawEnv.SHIPPING_QUOTE_SECRET)
      || (String(rawEnv.EDEN_RUNTIME || '').trim() === 'production' ? '' : LOCAL_SHIPPING_QUOTE_SECRET),
    SHIPPING_US_FIXED_TRANSIT_DAYS: Number(firstNonEmpty(rawEnv.SHIPPING_US_FIXED_TRANSIT_DAYS, '1')),
    METRICS_TOKEN: firstNonEmpty(rawEnv.METRICS_TOKEN)
  };

  assertShippingQuoteSecret(rawEnv, resolved);
  assertProductionEnv(rawEnv, resolved);
  return resolved;
}

module.exports = {
  parseEnv
};
