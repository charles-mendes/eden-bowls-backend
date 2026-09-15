const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function issueAccessToken(userId) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

describe('onboarding pet image routes', () => {
  test('uploads an image for a pet owned by the authenticated user', async () => {
    const onboardingPetImageService = {
      uploadImage: jest.fn().mockResolvedValue({
        success: true,
        data: {
          country: 'US',
          pet: { id: 'pet-1', image_url: 'http://localhost:3000/pet-photos/pet-pet-1-abc.jpg' },
          image_url: 'http://localhost:3000/pet-photos/pet-pet-1-abc.jpg'
        }
      })
    };
    const app = createApp({ onboardingPetImageService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/pets/pet-1/image')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ imageBase64: 'abc', mimeType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(response.body.data.image_url).toContain('/pet-photos/');
    expect(onboardingPetImageService.uploadImage).toHaveBeenCalledWith({
      userId: 7,
      petId: 'pet-1',
      payload: { imageBase64: 'abc', mimeType: 'image/jpeg' },
      market: MARKETS.US
    });
  });

  test('deletes an image for a pet owned by the authenticated user', async () => {
    const onboardingPetImageService = {
      deleteImage: jest.fn().mockResolvedValue({
        success: true,
        data: { country: 'US', pet: { id: 'pet-1', image_url: '' }, image_url: null }
      })
    };
    const app = createApp({ onboardingPetImageService, corsOrigins, jwt });

    const response = await request(app)
      .delete('/api/v1/onboarding/pets/pet-1/image')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.image_url).toBeNull();
    expect(onboardingPetImageService.deleteImage).toHaveBeenCalledWith({
      userId: 7,
      petId: 'pet-1',
      market: MARKETS.US
    });
  });

  test('does not call the service without bearer authentication', async () => {
    const onboardingPetImageService = { uploadImage: jest.fn(), deleteImage: jest.fn() };
    const app = createApp({ onboardingPetImageService, corsOrigins, jwt });

    const postResponse = await request(app)
      .post('/api/v1/onboarding/pets/pet-1/image')
      .send({ imageBase64: 'abc', mimeType: 'image/jpeg' });
    const deleteResponse = await request(app).delete('/api/v1/onboarding/pets/pet-1/image');

    expect(postResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
    expect(onboardingPetImageService.uploadImage).not.toHaveBeenCalled();
    expect(onboardingPetImageService.deleteImage).not.toHaveBeenCalled();
  });

  test('returns 404 when the pet belongs to another user', async () => {
    const { HttpError } = require('../src/core/http-error');
    const onboardingPetImageService = {
      uploadImage: jest.fn().mockRejectedValue(new HttpError(404, 'Pet not found.', { code: 'pet_not_found' }))
    };
    const app = createApp({ onboardingPetImageService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/pets/foreign-pet/image')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ imageBase64: 'abc', mimeType: 'image/jpeg' });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});
