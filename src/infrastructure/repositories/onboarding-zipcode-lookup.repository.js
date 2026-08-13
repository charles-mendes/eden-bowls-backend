class OnboardingZipcodeLookupRepository {
  async lookup(payload = {}) {
    return {
      status: 'found',
      country: payload.country || 'US',
      zipcode_input: payload.zipcode,
      zipcode: payload.zipcode,
      is_complete: true,
      state: 'CA',
      city: 'San Francisco',
      street: 'Market St',
      neighborhood: 'Downtown',
      complement: '',
      message: 'Address found.'
    };
  }
}

module.exports = {
  OnboardingZipcodeLookupRepository
};
