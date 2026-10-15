const { HttpError } = require('../core/http-error');
const { formatBrZipcode } = require('../core/shipping-fee');

const BR_STATES = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
]);

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
]);

// UPS CIE only answers address validation for these states.
const UPS_CIE_XAV_STATES = new Set(['NY', 'CA']);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function comparable(value) {
  return text(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

function invalid(country, address, errors, warnings = []) {
  return { valid: false, country, address, errors, warnings };
}

class ShippingHeadquartersService {
  constructor(options = {}) {
    this.viaCepClient = options.viaCepClient || null;
    this.nominatimClient = options.nominatimClient || null;
    this.zippopotamClient = options.zippopotamClient || null;
    this.upsClient = options.upsClient || null;
  }

  async validate(country, address = {}) {
    return country === 'US' ? this.validateUs(address) : this.validateBr(address);
  }

  async validateBr(input = {}) {
    const cep8 = text(input.zipcode).replace(/\D/g, '');
    const address = {
      street: text(input.street),
      number: text(input.number),
      complement: text(input.complement),
      neighborhood: text(input.neighborhood),
      city: text(input.city),
      state: text(input.state).toUpperCase(),
      zipcode: formatBrZipcode(cep8)
    };
    const errors = {};
    if (cep8.length !== 8) errors.zipcode = 'Informe um CEP com 8 dígitos.';
    if (!address.street) errors.street = 'Informe a rua.';
    if (!address.number) errors.number = 'Informe o número (use S/N se não houver).';
    if (!address.city) errors.city = 'Informe a cidade.';
    if (!BR_STATES.has(address.state)) errors.state = 'Escolha uma UF válida.';
    if (Object.keys(errors).length) {
      return invalid('BR', address, errors);
    }
    if (!this.viaCepClient || !this.nominatimClient) {
      throw new HttpError(503, 'Address services are not available.', { code: 'upstream_unavailable' });
    }

    const viaCep = await this.viaCepClient.lookup(cep8);
    if (viaCep.status === 'upstream') {
      throw new HttpError(503, 'O serviço de CEP não respondeu. Tente de novo em instantes.', { code: 'upstream_unavailable' });
    }
    if (viaCep.status !== 'ok') {
      return invalid('BR', address, { zipcode: 'CEP não encontrado.' });
    }
    if (comparable(viaCep.address.state) !== comparable(address.state)) {
      return invalid('BR', address, { state: `O CEP ${address.zipcode} é de ${viaCep.address.state}.` });
    }
    if (comparable(viaCep.address.city) !== comparable(address.city)) {
      return invalid('BR', address, { city: `O CEP ${address.zipcode} é de ${viaCep.address.city}.` });
    }
    address.city = viaCep.address.city;
    if (!address.neighborhood && viaCep.address.neighborhood) {
      address.neighborhood = viaCep.address.neighborhood;
    }

    const warnings = [];
    const number = /^s\/?n$/i.test(address.number) ? '' : address.number;
    let geo = await this.nominatimClient.geocodeBrAddress({ ...address, number });
    let precision = 'address';
    if (geo.status !== 'ok') {
      geo = await this.nominatimClient.geocodeBr({
        street: address.street,
        neighborhood: address.neighborhood,
        city: address.city,
        state: address.state,
        zipcode: cep8
      });
      precision = 'zipcode';
      warnings.push('O mapa não achou o número exato; a posição usa o centro do CEP. A distância pode variar algumas centenas de metros.');
    }
    if (geo.status !== 'ok') {
      return invalid('BR', address, { street: 'Não encontramos este endereço no mapa. Confira rua, número e CEP.' });
    }

    return {
      valid: true,
      country: 'BR',
      address,
      location: { lat: geo.lat, lng: geo.lng, precision, label: geo.label || '' },
      errors: {},
      warnings
    };
  }

  async validateUs(input = {}) {
    const zipDigits = text(input.zipcode).replace(/\D/g, '');
    const address = {
      street: text(input.street),
      street2: text(input.street2),
      city: text(input.city),
      state: text(input.state).toUpperCase(),
      zipcode: zipDigits.length === 9 ? `${zipDigits.slice(0, 5)}-${zipDigits.slice(5)}` : zipDigits.slice(0, 5)
    };
    const errors = {};
    if (!address.street) errors.street = 'Informe o Address line 1 (número e rua).';
    if (!address.city) errors.city = 'Informe a cidade.';
    if (!US_STATES.has(address.state)) errors.state = 'Escolha um estado válido.';
    if (!(zipDigits.length === 5 || zipDigits.length === 9)) errors.zipcode = 'Use ZIP de 5 dígitos ou ZIP+4.';
    if (Object.keys(errors).length) {
      return invalid('US', address, errors);
    }

    const warnings = [];
    if (this.zippopotamClient) {
      const lookup = await this.zippopotamClient.lookupUs(zipDigits);
      if (lookup.status === 'not_found') {
        return invalid('US', address, { zipcode: 'ZIP code não encontrado.' });
      }
      if (lookup.status === 'ok') {
        if (lookup.address.state !== address.state) {
          return invalid('US', address, { state: `O ZIP ${address.zipcode} é de ${lookup.address.state}.` });
        }
        if (comparable(lookup.address.city) !== comparable(address.city)) {
          warnings.push(`O ZIP ${address.zipcode} aparece como ${lookup.address.city}, ${lookup.address.state}. Confira a cidade.`);
        }
      } else {
        warnings.push('A consulta de ZIP não respondeu; só o formato foi conferido.');
      }
    }

    const ups = await this.upsAddressCheck(address);
    if (ups.status === 'no_candidates') {
      warnings.push('A UPS não reconheceu este endereço. Confira número e rua.');
    } else if (ups.status === 'ambiguous') {
      warnings.push('A UPS achou mais de um endereço parecido. Confira as sugestões.');
    }

    return { valid: true, country: 'US', address, ups, errors: {}, warnings };
  }

  async upsAddressCheck(address) {
    if (!this.upsClient || !this.upsClient.isConfigured()) {
      return { status: 'skipped', reason: 'not_configured', candidates: [] };
    }
    if (this.upsClient.envName === 'cie' && !UPS_CIE_XAV_STATES.has(address.state)) {
      return { status: 'skipped', reason: 'sandbox_state_unsupported', candidates: [] };
    }
    try {
      const result = await this.upsClient.validateAddress(address);
      return { ...result, environment: this.upsClient.envName };
    } catch (error) {
      return { status: 'error', reason: error.message, candidates: [] };
    }
  }
}

module.exports = {
  BR_STATES,
  ShippingHeadquartersService,
  US_STATES
};
