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
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().default('3306'),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default('root'),
  DB_NAME: z.string().default('eden_bowls'),
  BREEDS_TABLE_NAME: z.string().default('wp_hsr_breeds')
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

  return {
    NODE_ENV: rawEnv.NODE_ENV,
    PORT: Number(rawEnv.PORT),
    MODE: rawEnv.MODE,
    ENABLE_BACKGROUND_JOBS: toBoolean(rawEnv.ENABLE_BACKGROUND_JOBS),
    PRIME_ENABLE_UPDATE: toBoolean(rawEnv.PRIME_ENABLE_UPDATE),
    LOG_LEVEL: rawEnv.LOG_LEVEL || (rawEnv.NODE_ENV === 'development' ? 'debug' : 'info'),
    DB_HOST: rawEnv.DB_HOST,
    DB_PORT: Number(rawEnv.DB_PORT),
    DB_USER: rawEnv.DB_USER,
    DB_PASSWORD: rawEnv.DB_PASSWORD,
    DB_NAME: rawEnv.DB_NAME,
    BREEDS_TABLE_NAME: rawEnv.BREEDS_TABLE_NAME
  };
}

module.exports = {
  parseEnv
};