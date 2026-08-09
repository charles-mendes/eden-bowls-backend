const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const client = require('prom-client');
const { buildBearerTokenMiddleware } = require('./api/middleware/bearer-token.middleware');
const { registerAuthRoutes } = require('./api/routes/auth.routes');
const { registerBreedsRoutes } = require('./api/routes/breeds.routes');
const { registerProductsRoutes } = require('./api/routes/products.routes');
const { HttpError } = require('./core/http-error');

client.collectDefaultMetrics();

function buildCorsConfig(origins = []) {
  return {
    origins: Array.isArray(origins) ? origins : []
  };
}

function corsMiddleware(config) {
  return (request, response, next) => {
    const origin = request.headers.origin;
    const isAllowedOrigin = origin && config.origins.includes(origin);

    if (isAllowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Accept,Content-Type,Authorization');
    }

    if (request.method === 'OPTIONS') {
      response.status(isAllowedOrigin ? 204 : 403).end();
      return;
    }

    next();
  };
}

function createApp(dependencies = {}) {
  const app = express();
  const corsConfig = buildCorsConfig(dependencies.corsOrigins);

  app.disable('x-powered-by');
  app.use(corsMiddleware(corsConfig));
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use(buildBearerTokenMiddleware({
    authPath: '/api/v1/auth/token',
    jwt: dependencies.jwt || {}
  }));

  app.get('/health', (request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/liveness', (request, response) => {
    response.json({ status: 'alive' });
  });

  app.get('/readiness', (request, response) => {
    response.json({ status: 'ready' });
  });

  app.get('/metrics', async (request, response, next) => {
    try {
      response.set('Content-Type', client.register.contentType);
      response.send(await client.register.metrics());
    } catch (error) {
      next(error);
    }
  });

  registerBreedsRoutes(app, dependencies);
  registerProductsRoutes(app, dependencies);
  registerAuthRoutes(app, dependencies);

  app.use((request, response, next) => {
    next(new HttpError(404, 'Route not found.'));
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error.name === 'ZodError') {
      response.status(400).json({
        success: false,
        message: 'Invalid request payload.',
        details: error.issues
      });
      return;
    }

    const statusCode = Number(error.statusCode || error.status || 500);
    const message = statusCode >= 500 ? 'Internal server error.' : error.message;

    response.status(statusCode).json({
      success: false,
      message,
      details: error.details || undefined
    });
  });

  return app;
}

module.exports = {
  createApp
};