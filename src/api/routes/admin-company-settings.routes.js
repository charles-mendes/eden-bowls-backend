const { HttpError } = require('../../core/http-error');

function requireCompanyProfileService(dependencies) {
  if (!dependencies.companyProfileService) {
    throw new HttpError(503, 'Company profile service is not available.');
  }
  return dependencies.companyProfileService;
}

function requireAutomatedEmailSettingsService(dependencies) {
  if (!dependencies.automatedEmailSettingsService) {
    throw new HttpError(503, 'Automated email settings service is not available.');
  }
  return dependencies.automatedEmailSettingsService;
}

function singleMarket(request) {
  const market = (request.marketQuery || {}).market;
  if (!market) {
    throw new HttpError(400, 'Choose one market.', { code: 'market_required' });
  }
  return market;
}

// Settings pages of the admin, per market. Company profile (company-profile): reading needs settings.read,
// saving settings.company.write (admin only). Automated emails (automated-email-settings): reading needs
// settings.read, saving settings.email.write (admin and operator).
function registerAdminCompanySettingsRoutes(app, dependencies, { requirePermission, handle }) {
  app.get('/api/v1/admin/settings/company', requirePermission('settings.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireCompanyProfileService(dependencies).read(singleMarket(request)));
  });

  app.put('/api/v1/admin/settings/company', requirePermission('settings.company.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireCompanyProfileService(dependencies).update(
      singleMarket(request),
      // The fields go under `profile`: a `country` at the top would be read as the market filter.
      (request.body || {}).profile,
      request.adminIdentity
    ));
  });

  app.get('/api/v1/admin/settings/automated-emails', requirePermission('settings.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireAutomatedEmailSettingsService(dependencies).read(singleMarket(request)));
  });

  app.put('/api/v1/admin/settings/automated-emails', requirePermission('settings.email.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireAutomatedEmailSettingsService(dependencies).update(
      singleMarket(request),
      request.body || {},
      request.adminIdentity
    ));
  });
}

module.exports = {
  registerAdminCompanySettingsRoutes
};
