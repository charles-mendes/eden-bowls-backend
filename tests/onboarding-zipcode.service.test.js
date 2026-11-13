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
      payload: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo', recipient_name: 'Ana Costa' }
    });
    await service.setZipcode({
      userId: 7,
      payload: { country: 'US', zipcode: '10001', state: 'NY', city: 'New York', recipient_name: 'Ana Costa' }
    });

    expect(profileRepository.stampProfileMarketOnce).toHaveBeenNthCalledWith(1, 7, 'BR');
    expect(profileRepository.stampProfileMarketOnce).toHaveBeenNthCalledWith(2, 7, 'US');
    expect(profileRepository.stampProfileMarketOnce.mock.results[0].value).resolves.toBe('BR');
    expect(profileRepository.stampProfileMarketOnce.mock.results[1].value).resolves.toBe('BR');
  });
});

describe('OnboardingZipcodeService recipient name', () => {
  const base = { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' };
  function build() {
    const repository = { saveZipcode: jest.fn().mockImplementation(async (_userId, payload) => ({ zipcode: payload })) };
    return { service: new OnboardingZipcodeService(repository), repository };
  }

  test('stores the normalized recipient under its own key', async () => {
    const { service, repository } = build();
    await service.setZipcode({ userId: 7, payload: { ...base, recipient_name: '  João   Lima ' } });
    const saved = repository.saveZipcode.mock.calls[0][1];
    expect(saved.recipient_name).toBe('João Lima');
    expect(saved).not.toHaveProperty('name');
  });

  test.each([
    ['missing', {}],
    ['empty', { recipient_name: '' }],
    ['invalid', { recipient_name: 'a@b' }]
  ])('refuses a %s recipient and leaves the saved address alone', async (_label, extra) => {
    const { service, repository } = build();
    await expect(service.setZipcode({ userId: 7, payload: { ...base, ...extra } }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'invalid_recipient_name', field: 'recipient_name' } });
    expect(repository.saveZipcode).not.toHaveBeenCalled();
  });
});

describe('OnboardingZipcodeService delivery instructions', () => {
  const base = { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo', recipient_name: 'Ana Costa' };
  function build(stored) {
    const repository = {
      getAddress: jest.fn().mockResolvedValue(stored),
      saveZipcode: jest.fn().mockImplementation(async (_userId, payload) => ({ zipcode: payload }))
    };
    return { service: new OnboardingZipcodeService(repository), repository };
  }

  test('older client without the field keeps the stored instructions', async () => {
    const { service, repository } = build({ delivery_instructions: 'Interfone 12' });
    await service.setZipcode({ userId: 7, payload: base });
    expect(repository.saveZipcode.mock.calls[0][1].delivery_instructions).toBe('Interfone 12');
  });

  test('an empty string clears them', async () => {
    const { service, repository } = build({ delivery_instructions: 'Interfone 12' });
    await service.setZipcode({ userId: 7, payload: { ...base, delivery_instructions: '' } });
    expect(repository.saveZipcode.mock.calls[0][1].delivery_instructions).toBe('');
    expect(repository.getAddress).not.toHaveBeenCalled();
  });

  test('a value replaces them after the rule', async () => {
    const { service, repository } = build({ delivery_instructions: 'Interfone 12' });
    await service.setZipcode({ userId: 7, payload: { ...base, delivery_instructions: '  Deixar\n na portaria ' } });
    expect(repository.saveZipcode.mock.calls[0][1].delivery_instructions).toBe('Deixar na portaria');
  });

  test('201 characters are refused and nothing is saved', async () => {
    const { service, repository } = build(null);
    await expect(service.setZipcode({ userId: 7, payload: { ...base, delivery_instructions: 'a'.repeat(201) } }))
      .rejects.toMatchObject({ statusCode: 422, details: { field: 'delivery_instructions' } });
    expect(repository.saveZipcode).not.toHaveBeenCalled();
  });

  test('no stored address and no field stores none', async () => {
    const { service, repository } = build(null);
    await service.setZipcode({ userId: 7, payload: base });
    expect(repository.saveZipcode.mock.calls[0][1].delivery_instructions).toBe('');
  });
});
