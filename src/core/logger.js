const pino = require('pino');

function createLogger(options = {}) {
  const level = options.level || 'info';
  const isDevelopment = options.nodeEnv ? options.nodeEnv !== 'production' : process.env.NODE_ENV !== 'production';
  const redact = {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'otp', 'text', 'DB_PASSWORD', 'AUTH_SMTP_PASS', 'HSR_SMTP_PASS'],
    remove: true
  };

  if (!isDevelopment) {
    return pino({ level, redact });
  }

  // Use an in-process stream instead of a worker transport. Node --watch
  // otherwise treats the process as finished after the first log line.
  const pinoPretty = require('pino-pretty');

  return pino({
    level,
    redact
  }, pinoPretty({
    colorize: true,
    translateTime: 'SYS:standard',
    singleLine: true
  }));
}

module.exports = {
  createLogger
};