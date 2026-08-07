const pino = require('pino');

function createLogger(options = {}) {
  const level = options.level || 'info';
  const isDevelopment = options.nodeEnv ? options.nodeEnv !== 'production' : process.env.NODE_ENV !== 'production';

  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'DB_PASSWORD'],
      remove: true
    },
    transport: isDevelopment
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            singleLine: true
          }
        }
      : undefined
  });
}

module.exports = {
  createLogger
};