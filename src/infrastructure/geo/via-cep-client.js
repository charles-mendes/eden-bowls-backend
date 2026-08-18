const { fetchJson } = require('../http/fetch-json');

const VIA_CEP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

class ViaCepClient {
  constructor(options = {}) {
    this.cache = options.cache || null;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs || 5000;
  }

  async lookup(cep8) {
    const zipcode = String(cep8 || '').replace(/\D/g, '').slice(0, 8);
    if (zipcode.length !== 8) {
      return { status: 'not_found' };
    }

    const cacheKey = `viacep:${zipcode}`;
    if (this.cache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const response = await fetchJson(`https://viacep.com.br/ws/${encodeURIComponent(zipcode)}/json/`, {
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      headers: { Accept: 'application/json' }
    });

    if (!response.ok || !response.body || typeof response.body !== 'object') {
      return { status: 'upstream' };
    }

    if (response.body.erro) {
      const result = { status: 'not_found' };
      this.remember(cacheKey, result);
      return result;
    }

    const address = {
      street: String(response.body.logradouro || '').trim(),
      neighborhood: String(response.body.bairro || '').trim(),
      city: String(response.body.localidade || '').trim(),
      state: String(response.body.uf || '').trim(),
      complement: String(response.body.complemento || '').trim(),
      zipcode
    };

    if (!address.city || !address.state) {
      const result = { status: 'not_found' };
      this.remember(cacheKey, result);
      return result;
    }

    const result = { status: 'ok', address };
    this.remember(cacheKey, result);
    return result;
  }

  remember(key, value) {
    if (this.cache) {
      this.cache.set(key, value, VIA_CEP_TTL_MS);
    }
  }
}

module.exports = {
  ViaCepClient,
  VIA_CEP_TTL_MS
};
