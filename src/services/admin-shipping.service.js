const { HttpError } = require('../core/http-error');
const { constrainMarketQuery, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { mapRatedShipments, pickRate } = require('../infrastructure/shipping/ups-client');

const BR_ADDRESS_FIELDS = ['street', 'number', 'complement', 'neighborhood', 'city', 'state', 'zipcode'];
const US_ADDRESS_FIELDS = ['street', 'street2', 'city', 'state', 'zipcode'];

function addressChanged(fields, current = {}, next) {
  if (!next) return false;
  return fields.some((field) => next[field] !== undefined && String(next[field] || '').trim() !== String(current[field] || '').trim());
}

function headquartersInvalid(market, result) {
  return new HttpError(422, 'Endereço da sede inválido.', {
    code: 'headquarters_invalid',
    market,
    errors: result.errors,
    warnings: result.warnings
  });
}

async function timed(run) {
  const started = Date.now();
  try {
    return { value: await run(), ms: Date.now() - started };
  } catch (error) {
    return { error, ms: Date.now() - started };
  }
}

class AdminShippingService {
  constructor(options = {}) {
    this.shippingService = options.shippingService || null;
    this.repository = options.repository || null;
    this.headquartersService = options.headquartersService || null;
    // Always UPS CIE: the admin simulation never quotes against production.
    this.upsSandboxClient = options.upsSandboxClient || null;
    this.zippopotamClient = options.zippopotamClient || null;
  }

  ensureRepository() {
    if (!this.repository) {
      throw new HttpError(503, 'Shipping settings repository is not available.');
    }
  }

  applyToShippingService(settings) {
    if (this.shippingService) {
      this.shippingService.settings = settings;
    }
  }

  scopedSettings(settings, actor) {
    if (!shouldEnforceMarketScope(actor)) {
      return settings;
    }
    const scoped = constrainMarketQuery(actor, {});
    if (scoped.markets.includes('BR') && scoped.markets.includes('US')) {
      return settings;
    }
    const filtered = {};
    if (scoped.markets.includes('BR') && settings && settings.br) {
      filtered.br = settings.br;
    }
    if (scoped.markets.includes('US') && settings && settings.us) {
      filtered.us = settings.us;
    }
    return filtered;
  }

  scopedPayload(payload, actor) {
    if (!shouldEnforceMarketScope(actor)) {
      return payload;
    }
    const scoped = constrainMarketQuery(actor, {});
    const next = { ...payload };
    if (!scoped.markets.includes('BR')) {
      delete next.br;
    }
    if (!scoped.markets.includes('US')) {
      delete next.us;
    }
    return next;
  }

  async getSettings(actor = {}) {
    this.ensureRepository();
    const settings = await this.repository.get();
    this.applyToShippingService(settings);

    return {
      success: true,
      data: { settings: this.scopedSettings(settings, actor) }
    };
  }

  // A changed headquarters address is validated and, in Brazil, geocoded before it is stored.
  async resolveHeadquarters(payload) {
    if (!this.headquartersService) {
      return payload;
    }
    const brCenter = payload.br && payload.br.center;
    const usFrom = payload.us && payload.us.ship_from;
    if (!brCenter && !usFrom) {
      return payload;
    }
    const current = await this.repository.get();
    const next = { ...payload };

    if (addressChanged(BR_ADDRESS_FIELDS, current.br && current.br.center, brCenter)) {
      const merged = { ...(current.br && current.br.center), ...brCenter };
      const result = await this.headquartersService.validateBr(merged);
      if (!result.valid) {
        throw headquartersInvalid('BR', result);
      }
      next.br = {
        ...payload.br,
        center: { ...brCenter, ...result.address, lat: result.location.lat, lng: result.location.lng }
      };
    } else if (brCenter) {
      // Coordinates follow the address; they are never typed by hand.
      const { lat, lng, ...rest } = brCenter;
      next.br = { ...payload.br, center: rest };
    }

    if (addressChanged(US_ADDRESS_FIELDS, current.us && current.us.ship_from, usFrom)) {
      const merged = { ...(current.us && current.us.ship_from), ...usFrom };
      const result = await this.headquartersService.validateUs(merged);
      if (!result.valid) {
        throw headquartersInvalid('US', result);
      }
      next.us = { ...payload.us, ship_from: { ...usFrom, ...result.address, country: 'US' } };
    }

    return next;
  }

  async validateHeadquarters({ country, address }) {
    if (!this.headquartersService) {
      throw new HttpError(503, 'Address validation is not available.');
    }
    return { success: true, data: await this.headquartersService.validate(country, address) };
  }

  async saveSettings(payload = {}, actor = {}) {
    this.ensureRepository();
    const scoped = await this.resolveHeadquarters(this.scopedPayload(payload, actor));
    const settings = await this.repository.save(scoped);
    this.applyToShippingService(settings);

    return {
      success: true,
      data: { settings: this.scopedSettings(settings, actor) }
    };
  }

  async test(payload = {}) {
    if (!this.shippingService) {
      throw new HttpError(503, 'Shipping service is not available.');
    }

    await this.getSettings();
    if (payload.country !== 'US') {
      return this.shippingService.calculate(payload);
    }

    const us = this.shippingService.settings.us;
    let fixed = null;
    if ((us.quote_mode || 'fixed') !== 'ups') {
      const quote = await this.shippingService.calculate(payload);
      fixed = quote.data;
    }
    return {
      success: true,
      data: {
        country: 'US',
        quote_mode: us.quote_mode || 'fixed',
        fixed,
        ups: await this.simulateUps(payload.zipCode, us)
      }
    };
  }

  // Runs each UPS call the checkout depends on, against CIE, and reports every step.
  async simulateUps(zipCode, us) {
    const client = this.upsSandboxClient;
    const steps = [];
    const result = { environment: 'cie', steps, destination: null, rates: [], selected: null };
    const zip = String(zipCode || '').replace(/\D/g, '').slice(0, 5);

    if (!client || !client.isConfigured()) {
      steps.push({ key: 'oauth', label: 'Autenticação OAuth', status: 'error', detail: 'Credenciais UPS ausentes no servidor (UPS_CLIENT_ID / UPS_CLIENT_SECRET).' });
      return result;
    }

    const oauth = await timed(() => client.getAccessToken());
    steps.push({
      key: 'oauth',
      label: 'Autenticação OAuth',
      status: oauth.error ? 'error' : 'ok',
      detail: oauth.error ? oauth.error.message : 'Token emitido pela UPS sandbox (CIE).',
      ms: oauth.ms
    });
    if (oauth.error) return result;

    let destination = { city: '', state: '', zipcode: zip };
    if (this.zippopotamClient) {
      const lookup = await timed(() => this.zippopotamClient.lookupUs(zip));
      const found = lookup.value && lookup.value.status === 'ok';
      if (found) {
        destination = { ...destination, city: lookup.value.address.city, state: lookup.value.address.state };
      }
      steps.push({
        key: 'destination',
        label: 'Cidade e estado do ZIP',
        status: found ? 'ok' : 'error',
        detail: found ? `${destination.city}, ${destination.state} ${zip}` : `ZIP ${zip} não encontrado.`,
        ms: lookup.ms
      });
      if (!found) return result;
    }
    result.destination = destination;

    const shipFrom = us.ship_from || {};
    if (!String(shipFrom.zipcode || '').replace(/\D/g, '')) {
      steps.push({ key: 'origin', label: 'Endereço da sede (XAV)', status: 'error', detail: 'Cadastre o endereço da sede dos Estados Unidos.' });
      return result;
    }
    if (String(shipFrom.state || '').toUpperCase() === 'NY' || String(shipFrom.state || '').toUpperCase() === 'CA') {
      const xav = await timed(() => client.validateAddress(shipFrom));
      const status = xav.error ? 'warning' : (xav.value.status === 'valid' ? 'ok' : 'warning');
      steps.push({
        key: 'origin',
        label: 'Endereço da sede (XAV)',
        status,
        detail: xav.error ? xav.error.message : ({ valid: 'Endereço reconhecido pela UPS.', ambiguous: 'A UPS achou mais de um endereço parecido.', no_candidates: 'A UPS não reconheceu o endereço.' })[xav.value.status],
        ms: xav.ms
      });
    } else {
      steps.push({ key: 'origin', label: 'Endereço da sede (XAV)', status: 'skipped', detail: 'O sandbox da UPS só valida endereços de NY e CA.' });
    }

    const request = {
      shipFrom,
      shipTo: { name: 'Simulação', street: '', city: destination.city, state: destination.state, zipcode: zip, country: 'US' },
      package: us.package,
      allowedServiceCodes: []
    };
    let rated = await timed(() => client.rate({ ...request, withTransit: true }));
    let transit = true;
    if (rated.error) {
      steps.push({ key: 'rating_transit', label: 'Cotação com prazo (Shoptimeintransit)', status: 'warning', detail: rated.error.message, ms: rated.ms });
      rated = await timed(() => client.rate(request));
      transit = false;
    }
    steps.push({
      key: 'rating',
      label: transit ? 'Cotação com prazo (Shoptimeintransit)' : 'Cotação (Shop)',
      status: rated.error ? 'error' : 'ok',
      detail: rated.error ? rated.error.message : `${(rated.value.ratedShipments || []).length} serviço(s) cotado(s).`,
      ms: rated.ms
    });
    if (rated.error) return result;

    const allowed = new Set((us.allowed_service_codes || []).map(String));
    result.rates = mapRatedShipments(rated.value.ratedShipments).map((row) => ({
      service_code: row.serviceCode,
      label: row.label,
      amount: Number(row.monetaryValue.toFixed(2)),
      currency: row.currency,
      delivery_days: row.deliveryDays,
      allowed: allowed.has(row.serviceCode)
    }));
    const selected = pickRate(rated.value.ratedShipments, us.allowed_service_codes);
    result.selected = selected ? {
      service_code: selected.serviceCode,
      label: selected.label,
      amount: Number(selected.monetaryValue.toFixed(2)),
      currency: selected.currency,
      delivery_days: selected.deliveryDays
    } : null;
    return result;
  }
}

module.exports = {
  AdminShippingService
};
