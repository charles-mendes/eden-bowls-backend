const { OnboardingZipcodeService } = require('../src/services/onboarding-zipcode.service');

describe('OnboardingZipcodeService market stamp', () => {
  test('stamps profile market on first address and keeps it after a US follow-up', async () => {
    const repository = {
      saveZipcode: jest.fn().mockImplementation(async (_userId, payload) => ({ zipcode: payload }))
    };
    const profileRepository = {
      stampProfileMarketOnce: jest.fn()
        .mockResolvedValueOnce('BR')
        .mockResolvedValueOnce('BR')
    };
    const service = new OnboardingZipcodeService(repository, { profileRepository });

    await service.setZipcode({
      userId: 7,
      payload: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' }
    });
    await service.setZipcode({
      userId: 7,
      payload: { country: 'US', zipcode: '10001', state: 'NY', city: 'New York' }
    });

    expect(profileRepository.stampProfileMarketOnce).toHaveBeenNthCalledWith(1, 7, 'BR');
    expect(profileRepository.stampProfileMarketOnce).toHaveBeenNthCalledWith(2, 7, 'US');
    expect(profileRepository.stampProfileMarketOnce.mock.results[0].value).resolves.toBe('BR');
    expect(profileRepository.stampProfileMarketOnce.mock.results[1].value).resolves.toBe('BR');
  });
});
