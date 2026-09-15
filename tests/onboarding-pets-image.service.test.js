const { OnboardingPetImageService } = require('../src/services/onboarding-pets-image.service');
const { HttpError } = require('../src/core/http-error');

const JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9, 0x00, 0x10]);
const JPEG_BASE64 = JPEG_BYTES.toString('base64');

function createPet(overrides = {}) {
  return {
    id: 'pet-1',
    name: 'Luna',
    breed: 'Mixed',
    age_years: 2,
    age_months: 0,
    weight_input: 10,
    weight_unit: 'kg',
    weight: 10,
    size: 'medium',
    activity_level: 'medium',
    pet_condition: 'ideal',
    neutered: true,
    image_url: '',
    ...overrides
  };
}

function createService(overrides = {}) {
  const repository = {
    findPet: jest.fn().mockResolvedValue(createPet()),
    setImageUrl: jest.fn().mockImplementation(async (_userId, _petId, imageUrl) => (
      createPet({ image_url: imageUrl || '' })
    )),
    ...overrides.repository
  };
  const petPhotoStorage = {
    write: jest.fn().mockResolvedValue('http://localhost:3000/pet-photos/pet-pet-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides.petPhotoStorage
  };

  return {
    repository,
    petPhotoStorage,
    service: new OnboardingPetImageService(repository, petPhotoStorage)
  };
}

describe('OnboardingPetImageService', () => {
  test('writes the file, stores image_url, and returns the public URL', async () => {
    const { service, repository, petPhotoStorage } = createService();

    const result = await service.uploadImage({
      userId: 7,
      petId: 'pet-1',
      payload: { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg' }
    });

    expect(result.data.image_url).toContain('/pet-photos/');
    expect(petPhotoStorage.write).toHaveBeenCalledWith(expect.objectContaining({ petId: 'pet-1', ext: 'jpg' }));
    expect(repository.setImageUrl).toHaveBeenCalledWith(
      7,
      'pet-1',
      'http://localhost:3000/pet-photos/pet-pet-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
    );
  });

  test('rejects data-URI, gif, and oversized decoded buffers', async () => {
    const { service } = createService();

    await expect(service.uploadImage({
      userId: 7,
      petId: 'pet-1',
      payload: { imageBase64: `data:image/jpeg;base64,${JPEG_BASE64}`, mimeType: 'image/jpeg' }
    })).rejects.toMatchObject({ details: { code: 'invalid_image' } });

    await expect(service.uploadImage({
      userId: 7,
      petId: 'pet-1',
      payload: { imageBase64: JPEG_BASE64, mimeType: 'image/gif' }
    })).rejects.toMatchObject({ details: { code: 'invalid_mime' } });

    const huge = Buffer.alloc((3 * 1024 * 1024) + 1, 0);
    huge[0] = 0xFF;
    huge[1] = 0xD8;
    huge[2] = 0xFF;
    await expect(service.uploadImage({
      userId: 7,
      petId: 'pet-1',
      payload: { imageBase64: huge.toString('base64'), mimeType: 'image/jpeg' }
    })).rejects.toMatchObject({ details: { code: 'image_too_large' } });
  });

  test('returns 404 for a missing or foreign pet', async () => {
    const { service } = createService({
      repository: { findPet: jest.fn().mockResolvedValue(null) }
    });

    await expect(service.uploadImage({
      userId: 7,
      petId: 'foreign-pet',
      payload: { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg' }
    })).rejects.toMatchObject({ statusCode: 404, details: { code: 'pet_not_found' } });
  });

  test('deletes the previous file after a successful URL update', async () => {
    const previousUrl = 'http://localhost:3000/pet-photos/pet-pet-1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg';
    const { service, petPhotoStorage, repository } = createService({
      repository: {
        findPet: jest.fn().mockResolvedValue(createPet({ image_url: previousUrl })),
        setImageUrl: jest.fn().mockResolvedValue(createPet({
          image_url: 'http://localhost:3000/pet-photos/pet-pet-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
        }))
      }
    });

    await service.uploadImage({
      userId: 7,
      petId: 'pet-1',
      payload: { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg' }
    });

    expect(petPhotoStorage.delete).toHaveBeenCalledWith(previousUrl);
    expect(repository.setImageUrl).toHaveBeenCalled();
  });

  test('clears image_url and deletes the file on deleteImage', async () => {
    const previousUrl = 'http://localhost:3000/pet-photos/pet-pet-1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg';
    const { service, petPhotoStorage, repository } = createService({
      repository: {
        findPet: jest.fn().mockResolvedValue(createPet({ image_url: previousUrl })),
        setImageUrl: jest.fn().mockResolvedValue(createPet({ image_url: '' }))
      }
    });

    const result = await service.deleteImage({ userId: 7, petId: 'pet-1' });

    expect(result.data.image_url).toBeNull();
    expect(repository.setImageUrl).toHaveBeenCalledWith(7, 'pet-1', null);
    expect(petPhotoStorage.delete).toHaveBeenCalledWith(previousUrl);
  });

  test('deletes the newly written file when setImageUrl fails', async () => {
    const { service, petPhotoStorage } = createService({
      repository: {
        findPet: jest.fn().mockResolvedValue(createPet()),
        setImageUrl: jest.fn().mockRejectedValue(new Error('db down'))
      }
    });

    await expect(service.uploadImage({
      userId: 7,
      petId: 'pet-1',
      payload: { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg' }
    })).rejects.toMatchObject({ details: { code: 'upload_failed' } });

    expect(petPhotoStorage.delete).toHaveBeenCalledWith(
      'http://localhost:3000/pet-photos/pet-pet-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
    );
  });
});
