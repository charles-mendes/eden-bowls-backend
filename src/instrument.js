require('dotenv').config();

const Sentry = require('@sentry/node');

const dsn = String(process.env.SENTRY_DSN || '').trim();

if (dsn) {
  const fallbackSampleRate = process.env.NODE_ENV === 'development' ? 1 : 0.1;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    includeLocalVariables: true,
    tracesSampler({ name, inheritOrSampleWith }) {
      if (
        name.includes('/health')
        || name.includes('/readiness')
        || name.includes('/metrics')
      ) {
        return 0;
      }

      return inheritOrSampleWith(fallbackSampleRate);
    }
  });
}
