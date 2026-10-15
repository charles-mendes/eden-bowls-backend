const { collectApiRoutes, readManifest, routeKey } = require('../src/scripts/api-routes-manifest');

describe('api routes manifest', () => {
  test('docs/api-routes.json lists exactly the /api/v1 routes the app registers', () => {
    const registered = collectApiRoutes().map(routeKey);
    const committed = readManifest().map(routeKey);

    const missingFromManifest = registered.filter((key) => !committed.includes(key));
    const notRegistered = committed.filter((key) => !registered.includes(key));

    // Run `npm run routes:manifest` and commit docs/api-routes.json when this fails.
    expect({ missingFromManifest, notRegistered }).toEqual({ missingFromManifest: [], notRegistered: [] });
  });

  test('includes the admin system health routes', () => {
    const committed = readManifest().map(routeKey);
    expect(committed).toEqual(expect.arrayContaining([
      'GET /api/v1/admin/markets/conflicts',
      'GET /api/v1/admin/billing/webhooks/health'
    ]));
  });
});
