const { OnboardingPetsService } = require('../src/services/onboarding-pets.service');
const { MARKETS } = require('../src/core/market');

describe('OnboardingPetsService', () => {
  test('returns persisted pets without reading fallback sources', async () => {
    const repository = {
      listPets: jest.fn().mockResolvedValue({
        pets: [{ id: 'pet-1', name: 'Milo', weight_input: 10, weight_unit: 'kg' }]
      })
    };
    const planSelectionRepository = { getPlanSelection: jest.fn() };
    const service = new OnboardingPetsService(repository, { planSelectionRepository });

    const result = await service.listPets({ userId: 5, market: MARKETS.US });

    expect(result.data.pets).toEqual([
      expect.objectContaining({ id: 'pet-1', name: 'Milo' })
    ]);
    expect(planSelectionRepository.getPlanSelection).not.toHaveBeenCalled();
  });

  test('hydrates and persists pets from plan selection when the table is empty', async () => {
    const repository = {
      listPets: jest.fn()
        .mockResolvedValueOnce({ pets: [] })
        .mockResolvedValue({
          pets: [{
            id: '526fb705-9da4-4d27-965e-da39a20d3b12',
            name: 'luna',
            breed: 'Maltês',
            age_years: 2,
            age_months: 0,
            weight_input: 28.66,
            weight_unit: 'lb'
          }]
        })
    };
    const planSelectionRepository = {
      getPlanSelection: jest.fn().mockResolvedValue({
        pets: [{
          pet_id: '526fb705-9da4-4d27-965e-da39a20d3b12',
          pet_name: 'luna',
          breed: 'Maltês',
          age_years: 2,
          weight: '28.66',
          weight_unit: 'lb',
          enabled: true
        }]
      })
    };
    const petsSyncRepository = {
      syncPets: jest.fn().mockResolvedValue({ pets: [{ id: '526fb705-9da4-4d27-965e-da39a20d3b12' }] })
    };
    const service = new OnboardingPetsService(repository, {
      planSelectionRepository,
      petsSyncRepository
    });

    const result = await service.listPets({ userId: 5, market: MARKETS.BR });

    expect(petsSyncRepository.syncPets).toHaveBeenCalledWith(5, [
      expect.objectContaining({
        pet_id: '526fb705-9da4-4d27-965e-da39a20d3b12',
        name: 'luna',
        weight_unit: 'lb'
      })
    ]);
    expect(result.data.pets).toEqual([
      expect.objectContaining({
        id: '526fb705-9da4-4d27-965e-da39a20d3b12',
        name: 'luna'
      })
    ]);
    expect(result.data.country).toBe('BR');
  });

  test('hydrates pets from the subscription ledger when plan selection is empty', async () => {
    const repository = {
      listPets: jest.fn().mockResolvedValue({ pets: [] })
    };
    const planSelectionRepository = {
      getPlanSelection: jest.fn().mockResolvedValue(null)
    };
    const ledgerRepository = {
      listByUserId: jest.fn().mockResolvedValue([{
        petsSnapshot: {
          pet_ids: ['526fb705-9da4-4d27-965e-da39a20d3b12'],
          pets_names: ['luna']
        }
      }])
    };
    const service = new OnboardingPetsService(repository, {
      planSelectionRepository,
      ledgerRepository
    });

    const result = await service.listPets({ userId: 5, market: MARKETS.BR });

    expect(result.data.pets).toEqual([
      expect.objectContaining({
        id: '526fb705-9da4-4d27-965e-da39a20d3b12',
        name: 'luna'
      })
    ]);
  });
});
