const { OnboardingZipcodeLookupService } = require('../src/services/onboarding-zipcode-lookup.service');

describe('OnboardingZipcodeLookupService', () => {
  test('returns incomplete for a short US zip without calling the repository', async () => {
    const repository = { lookup: jest.fn() };
    const service = new OnboardingZipcodeLookupService(repository);

    const result = await service.lookup({ payload: { zipcode: '94', country: 'US' } });

    expect(result.data.status).toBe('incomplete');
    expect(repository.lookup).not.toHaveBeenCalled();
  });

  test('strips non-digits before validating a Brazilian CEP', async () => {
    const repository = {
      lookup: jest.fn().mockResolvedValue({ status: 'found', country: 'BR', zipcode: '01310100' })
    };
    const service = new OnboardingZipcodeLookupService(repository);

    const result = await service.lookup({ payload: { zipcode: '01310-100', country: 'BR' } });

    expect(result.data.status).toBe('found');
    expect(repository.lookup).toHaveBeenCalledWith({ country: 'BR', zipcode: '01310100' });
  });

  test('maps ViaCEP erro to not_found through the repository', async () => {
    const repository = {
      lookup: jest.fn().mockResolvedValue({
        status: 'not_found',
        country: 'BR',
        zipcode: '00000000',
        message: 'Postal code not found.'
      })
    };
    const service = new OnboardingZipcodeLookupService(repository);

    const result = await service.lookup({ payload: { zipcode: '00000000', country: 'BR' } });

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('not_found');
  });
});
