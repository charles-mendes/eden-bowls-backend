const crypto = require('crypto');
const { fetchJson } = require('../http/fetch-json');

const API_BASE_URL = 'https://api.bling.com.br/Api/v3';
const AUTHORIZE_URL = 'https://bling.com.br/Api/v3/oauth/authorize';
const TOKEN_URL = 'https://bling.com.br/Api/v3/oauth/token';
const REQUEST_TIMEOUT_MS = 10 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
// Bling allows 3 requests per second per account.
const MIN_REQUEST_GAP_MS = 350;
const TOKEN_SKEW_MS = 60 * 1000;
const DEFAULT_ACCESS_TTL_SECONDS = 3600;
// A refresh token dies after 30 days. Renewing weekly keeps the grant alive through a month with no BR charge.
const KEEP_ALIVE_MS = 7 * 24 * 60 * 60 * 1000;

class BlingApiError extends Error {
  constructor(message, { status = 0, type = '' } = {}) {
    super(message);
    this.name = 'BlingApiError';
    this.status = status;
    this.type = type;
  }
}

class BlingNotConnectedError extends Error {
  constructor(message = 'Bling is not authorized.') {
    super(message);
    this.name = 'BlingNotConnectedError';
  }
}

function hashState(state) {
  return crypto.createHash('sha256').update(String(state)).digest('hex');
}

function errorMessage(response) {
  const error = response.body && response.body.error;
  if (response.timeout) return 'Bling did not answer in time.';
  if (response.networkError) return 'Bling could not be reached.';
  if (!error) return `Bling answered ${response.status}.`;
  const fields = Array.isArray(error.fields) ? error.fields.map((field) => field && field.msg).filter(Boolean) : [];
  return [error.message, error.description, ...fields].filter(Boolean).join(' · ') || `Bling answered ${response.status}.`;
}

function queryString(query = {}) {
  const pairs = [];
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      pairs.push(`${encodeURIComponent(key).replace('%5B%5D', '[]')}=${encodeURIComponent(item)}`);
    }
  }
  return pairs.length ? `?${pairs.join('&')}` : '';
}

class BlingClient {
  constructor(options = {}) {
    this.clientId = options.clientId || '';
    this.clientSecret = options.clientSecret || '';
    this.redirectUri = options.redirectUri || '';
    this.connection = options.connection || null;
    this.fetchImpl = options.fetchImpl;
    this.now = options.now || (() => new Date());
    this.wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.lastRequestAt = 0;
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret && this.redirectUri && this.connection);
  }

  async buildAuthorizeUrl() {
    const state = crypto.randomBytes(32).toString('hex');
    await this.connection.saveState({
      stateHash: hashState(state),
      expiresAt: new Date(this.now().getTime() + STATE_TTL_MS)
    });
    return `${AUTHORIZE_URL}${queryString({ response_type: 'code', client_id: this.clientId, state })}`;
  }

  consumeState(state) {
    return this.connection.consumeState({ stateHash: hashState(state), now: this.now() });
  }

  tokenRequest(form) {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    return fetchJson(TOKEN_URL, {
      method: 'POST',
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetchImpl: this.fetchImpl,
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'enable-jwt': '1'
      },
      body: new URLSearchParams(form).toString()
    });
  }

  async storeGrant(body, previousRefreshToken) {
    const accessToken = body && body.access_token;
    if (!accessToken) throw new BlingApiError('Bling returned no access token.');
    const ttlSeconds = Number(body.expires_in) > 0 ? Number(body.expires_in) : DEFAULT_ACCESS_TTL_SECONDS;
    const now = this.now();
    const grant = {
      accessToken,
      refreshToken: body.refresh_token || previousRefreshToken,
      accessExpiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      now
    };
    await this.connection.saveTokens(grant);
    return grant;
  }

  async exchangeCode(code) {
    const response = await this.tokenRequest({ grant_type: 'authorization_code', code: String(code) });
    if (!response.ok) {
      throw new BlingApiError(errorMessage(response), { status: response.status });
    }
    await this.storeGrant(response.body);
  }

  async refresh(refreshToken) {
    const response = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (response.ok) {
      return this.storeGrant(response.body, refreshToken);
    }
    // 400 or 401 here means the grant is gone; a timeout or a 5xx leaves it to the next tick.
    if (response.status === 400 || response.status === 401) {
      await this.connection.markNeedsAuthorization();
      throw new BlingNotConnectedError('The Bling authorization expired. Authorize it again.');
    }
    throw new BlingApiError(errorMessage(response), { status: response.status });
  }

  async readGrant() {
    const grant = await this.connection.read();
    if (!grant || grant.needsAuthorization || !grant.refreshToken) {
      throw new BlingNotConnectedError();
    }
    return grant;
  }

  async accessToken({ force = false } = {}) {
    const grant = await this.readGrant();
    const fresh = grant.accessToken && grant.accessExpiresAt
      && grant.accessExpiresAt.getTime() - TOKEN_SKEW_MS > this.now().getTime();
    if (fresh && !force) return grant.accessToken;
    const renewed = await this.refresh(grant.refreshToken);
    return renewed.accessToken;
  }

  async isConnected() {
    const grant = this.connection ? await this.connection.read() : null;
    return Boolean(grant && !grant.needsAuthorization && grant.refreshToken);
  }

  async keepAlive() {
    const grant = await this.readGrant();
    const age = grant.refreshedAt ? this.now().getTime() - grant.refreshedAt.getTime() : Infinity;
    if (age >= KEEP_ALIVE_MS) {
      await this.refresh(grant.refreshToken);
    }
  }

  async throttle() {
    const waitMs = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (waitMs > 0) await this.wait(waitMs);
    this.lastRequestAt = Date.now();
  }

  async send(method, path, { query, body, token }) {
    await this.throttle();
    return fetchJson(`${API_BASE_URL}${path}${queryString(query)}`, {
      method,
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetchImpl: this.fetchImpl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body
    });
  }

  async request(method, path, options = {}) {
    let response = await this.send(method, path, { ...options, token: await this.accessToken() });
    if (response.status === 401) {
      response = await this.send(method, path, { ...options, token: await this.accessToken({ force: true }) });
    }
    if (!response.ok) {
      const error = response.body && response.body.error;
      throw new BlingApiError(errorMessage(response), { status: response.status, type: error && error.type });
    }
    return response.body;
  }

  async findContactByDocument(document) {
    const body = await this.request('GET', '/contatos', { query: { numeroDocumento: document } });
    const contacts = body && Array.isArray(body.data) ? body.data : [];
    return contacts.find((contact) => String(contact.numeroDocumento || '').replace(/\D/g, '') === document) || null;
  }

  async createContact(payload) {
    const body = await this.request('POST', '/contatos', { body: payload });
    return body && body.data;
  }

  async findProductByCode(code) {
    const body = await this.request('GET', '/produtos', { query: { 'codigos[]': [code] } });
    const products = body && Array.isArray(body.data) ? body.data : [];
    return products.find((product) => product.codigo === code) || null;
  }

  async createProduct(payload) {
    const body = await this.request('POST', '/produtos', { body: payload });
    return body && body.data;
  }

  async findOrderByStoreNumber(storeNumber) {
    const body = await this.request('GET', '/pedidos/vendas', { query: { 'numerosLojas[]': [storeNumber] } });
    const orders = body && Array.isArray(body.data) ? body.data : [];
    return orders.find((order) => order.numeroLoja === storeNumber) || null;
  }

  async getOrder(orderId) {
    const body = await this.request('GET', `/pedidos/vendas/${orderId}`);
    return body && body.data;
  }

  async createOrder(payload) {
    const body = await this.request('POST', '/pedidos/vendas', { body: payload });
    return body && body.data;
  }

  async generateNfe(orderId) {
    return this.request('POST', `/pedidos/vendas/${orderId}/gerar-nfe`);
  }

  async listNfes(query) {
    const body = await this.request('GET', '/nfe', { query });
    return body && Array.isArray(body.data) ? body.data : [];
  }

  async getNfe(nfeId) {
    const body = await this.request('GET', `/nfe/${nfeId}`);
    return body && body.data;
  }

  async updateNfe(nfeId, payload) {
    const body = await this.request('PUT', `/nfe/${nfeId}`, { body: payload });
    return body && body.data;
  }

  async sendNfe(nfeId) {
    const body = await this.request('POST', `/nfe/${nfeId}/enviar`);
    return body && body.data;
  }
}

module.exports = {
  BlingApiError,
  BlingClient,
  BlingNotConnectedError
};
