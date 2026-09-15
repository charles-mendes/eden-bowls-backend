const { OnboardingPetDeleteService } = require('../src/services/onboarding-pets-delete.service');

describe('OnboardingPetDeleteService', () => {
  test('deletes the pet photo file after a successful soft delete', async () => {
    const repository = {
      deletePet: jest.fn().mockResolvedValue({
        removed_pet: { id: 'pet-1', deleted_by_user_id: 7 }
      })
    };
    const findPet = jest.fn().mockResolvedValue({
      id: 'pet-1',
      image_url: 'http://localhost:3000/pet-photos/pet-pet-1-abc.jpg'
    });
    const petPhotoStorage = { delete: jest.fn().mockResolvedValue(undefined) };
    const service = new OnboardingPetDeleteService(repository, { findPet, petPhotoStorage });

    await service.deletePet({ userId: 7, petId: 'pet-1' });

    expect(findPet).toHaveBeenCalledWith(7, 'pet-1');
    expect(petPhotoStorage.delete).toHaveBeenCalledWith('http://localhost:3000/pet-photos/pet-pet-1-abc.jpg');
  });
});
