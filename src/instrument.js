require('dotenv').config();

const Sentry = require('@sentry/node');

const dsn = String(process.env.SENTRY_DSN || '').trim();
const nodeEnv = process.env.NODE_ENV || 'development';
const isLocalDevelopment = nodeEnv === 'development' || nodeEnv === 'test';

if (dsn && !isLocalDevelopment) {
  Sentry.init({
    dsn,
    environment: nodeEnv,
    includeLocalVariables: true,
    tracesSampler({ name, inheritOrSampleWith }) {
      if (
        name.includes('/health')
        || name.includes('/readiness')
        || name.includes('/metrics')
      ) {
        return 0;
      }

      return inheritOrSampleWith(0.1);
    }
  });
}
