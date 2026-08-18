class OnboardingZipcodeLookupRepository {
  constructor(options = {}) {
    this.viaCepClient = options.viaCepClient || null;
    this.zippopotamClient = options.zippopotamClient || null;
  }

  async lookup(payload = {}) {
    const country = String(payload.country || '').toUpperCase();
    const zipcode = String(payload.zipcode || '').trim();

    if (country === 'BR') {
      return this.lookupBr(zipcode);
    }

    if (country === 'US') {
      return this.lookupUs(zipcode);
    }

    return this.emptyResult('invalid', country, zipcode, 'Postal code contains invalid characters.');
  }

  async lookupBr(zipcode) {
    if (!this.viaCepClient) {
      return this.emptyResult('error', 'BR', zipcode, 'Postal code service is temporarily unavailable.');
    }

    const result = await this.viaCepClient.lookup(zipcode);
    if (result.status === 'upstream') {
      return this.emptyResult('error', 'BR', zipcode, 'Postal code service is temporarily unavailable.');
    }
    if (result.status !== 'ok') {
      return this.emptyResult('not_found', 'BR', zipcode, 'Postal code not found.');
    }

    return {
      status: 'found',
      country: 'BR',
      zipcode_input: zipcode,
      zipcode: result.address.zipcode,
      is_complete: true,
      state: result.address.state,
      city: result.address.city,
      street: result.address.street,
      neighborhood: result.address.neighborhood,
      complement: result.address.complement,
      message: 'Address found.'
    };
  }

  async lookupUs(zipcode) {
    if (!this.zippopotamClient) {
      return this.emptyResult('error', 'US', zipcode, 'Postal code service is temporarily unavailable.');
    }

    const result = await this.zippopotamClient.lookupUs(zipcode);
    if (result.status === 'upstream') {
      return this.emptyResult('error', 'US', zipcode, 'Postal code service is temporarily unavailable.');
    }
    if (result.status !== 'ok') {
      return this.emptyResult('not_found', 'US', zipcode, 'Postal code not found.');
    }

    return {
      status: 'found',
      country: 'US',
      zipcode_input: zipcode,
      zipcode: result.address.zipcode,
      is_complete: true,
      state: result.address.state,
      city: result.address.city,
      street: '',
      neighborhood: '',
      complement: '',
      message: 'Address found.'
    };
  }

  emptyResult(status, country, zipcode, message) {
    return {
      status,
      country,
      zipcode_input: zipcode,
      zipcode,
      is_complete: false,
      state: '',
      city: '',
      street: '',
      neighborhood: '',
      complement: '',
      message
    };
  }
}

module.exports = {
  OnboardingZipcodeLookupRepository
};
