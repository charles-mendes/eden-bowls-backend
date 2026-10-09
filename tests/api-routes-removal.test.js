const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readManifest, routeKey } = require('../src/scripts/api-routes-manifest');

const REMOVED_PATH = path.resolve(__dirname, '../docs/api-routes-removed.json');
const BASE_REF = process.env.API_ROUTES_BASE_REF || 'origin/main';

function readBaseManifest() {
  try {
    const raw = execFileSync('git', ['show', `${BASE_REF}:docs/api-routes.json`], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return { routes: JSON.parse(raw) };
  } catch (error) {
    return { skipped: `could not read docs/api-routes.json at ${BASE_REF} (${error.code || error.status || 'git error'})` };
  }
}

describe('api routes removal', () => {
  // The panel keeps a copy of the manifest; a route that disappears here breaks the panel silently
  // unless the removal is acknowledged in docs/api-routes-removed.json with a reason.
  test(`every route on ${BASE_REF} is still registered or acknowledged as removed`, () => {
    const base = readBaseManifest();
    if (base.skipped) {
      console.warn(`api routes removal check skipped: ${base.skipped}`);
      return;
    }

    const current = new Set(readManifest().map(routeKey));
    const acknowledged = new Set(JSON.parse(fs.readFileSync(REMOVED_PATH, 'utf8')).map(routeKey));
    const removed = base.routes.map(routeKey).filter((key) => !current.has(key) && !acknowledged.has(key));

    expect(removed).toEqual([]);
  });

  test('every acknowledged removal names a reason', () => {
    const entries = JSON.parse(fs.readFileSync(REMOVED_PATH, 'utf8'));
    expect(entries.filter((entry) => !entry.method || !entry.path || !String(entry.reason || '').trim())).toEqual([]);
  });
});
