const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.resolve(__dirname, '../../docs/api-routes.json');
const API_PREFIX = '/api/v1';

// Every route the app registers under /api/v1, read from the Express router itself. Routes are
// registered regardless of which services are wired, so an app built with no dependencies is enough.
function collectApiRoutes() {
  const { createApp } = require('../app');
  const app = createApp({
    corsOrigins: [],
    jwt: { secret: 'manifest', algorithm: 'HS256', issuer: 'manifest' },
    logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }
  });
  const routes = new Map();

  for (const layer of app.router.stack) {
    if (!layer.route || typeof layer.route.path !== 'string' || !layer.route.path.startsWith(API_PREFIX)) {
      continue;
    }
    for (const method of Object.keys(layer.route.methods)) {
      if (!layer.route.methods[method]) {
        continue;
      }
      const route = { method: method.toUpperCase(), path: layer.route.path };
      routes.set(`${route.method} ${route.path}`, route);
    }
  }

  return [...routes.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function formatManifest(routes) {
  return `${JSON.stringify(routes, null, 2)}\n`;
}

function readManifest(file = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function routeKey(route) {
  return `${route.method} ${route.path}`;
}

if (require.main === module) {
  const routes = collectApiRoutes();
  fs.writeFileSync(MANIFEST_PATH, formatManifest(routes));
  console.log(`Wrote ${routes.length} routes to ${path.relative(process.cwd(), MANIFEST_PATH)}`);
}

module.exports = {
  MANIFEST_PATH,
  collectApiRoutes,
  formatManifest,
  readManifest,
  routeKey
};
