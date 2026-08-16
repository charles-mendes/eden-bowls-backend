const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config();

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3000'),
  MODE: z.enum(['all', 'http', 'cron', 'worker']).default('http'),
  ENABLE_BACKGROUND_JOBS: z.string().optional(),
  PRIME_ENABLE_UPDATE: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
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
  BREEDS_TABLE_NAME: z.string().default('wp_hsr_breeds'),
  PRICE_ZONE_POLICY_TABLE_NAME: z.string().default('price_zone_policy'),
  WP_USERS_TABLE_NAME: z.string().default('wp_users'),
  WP_USERMETA_TABLE_NAME: z.string().default('wp_usermeta'),
  WP_POSTS_TABLE_NAME: z.string().default('wp_posts'),
  WP_POSTMETA_TABLE_NAME: z.string().default('wp_postmeta'),
  WP_TERMS_TABLE_NAME: z.string().default('wp_terms'),
  WP_TERM_TAXONOMY_TABLE_NAME: z.string().default('wp_term_taxonomy'),
  WP_TERM_RELATIONSHIPS_TABLE_NAME: z.string().default('wp_term_relationships')
});

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

function parseEnv(source = process.env) {
  const rawEnv = rawEnvSchema.parse(source);
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

  return {
    NODE_ENV: rawEnv.NODE_ENV,
    PORT: Number(rawEnv.PORT),
    MODE: rawEnv.MODE,
    ENABLE_BACKGROUND_JOBS: toBoolean(rawEnv.ENABLE_BACKGROUND_JOBS),
    PRIME_ENABLE_UPDATE: toBoolean(rawEnv.PRIME_ENABLE_UPDATE),
    LOG_LEVEL: rawEnv.LOG_LEVEL || (rawEnv.NODE_ENV === 'development' ? 'debug' : 'info'),
    CORS_ORIGINS: corsOrigins,
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
    AUTH_OTP_TTL_SECONDS: Number(rawEnv.AUTH_OTP_TTL_SECONDS),
    AUTH_OTP_MAX_ATTEMPTS: Number(rawEnv.AUTH_OTP_MAX_ATTEMPTS),
    BREEDS_TABLE_NAME: rawEnv.BREEDS_TABLE_NAME,
    PRICE_ZONE_POLICY_TABLE_NAME: rawEnv.PRICE_ZONE_POLICY_TABLE_NAME,
    WP_USERS_TABLE_NAME: rawEnv.WP_USERS_TABLE_NAME,
    WP_USERMETA_TABLE_NAME: rawEnv.WP_USERMETA_TABLE_NAME,
    WP_POSTS_TABLE_NAME: rawEnv.WP_POSTS_TABLE_NAME,
    WP_POSTMETA_TABLE_NAME: rawEnv.WP_POSTMETA_TABLE_NAME,
    WP_TERMS_TABLE_NAME: rawEnv.WP_TERMS_TABLE_NAME,
    WP_TERM_TAXONOMY_TABLE_NAME: rawEnv.WP_TERM_TAXONOMY_TABLE_NAME,
    WP_TERM_RELATIONSHIPS_TABLE_NAME: rawEnv.WP_TERM_RELATIONSHIPS_TABLE_NAME
  };
}

module.exports = {
  parseEnv
};