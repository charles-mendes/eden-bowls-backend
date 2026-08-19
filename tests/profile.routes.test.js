const request = require('supertest');
const { createApp } = require('../src/app');
const { HttpError } = require('../src/core/http-error');
const { issueJwtToken } = require('../src/core/jwt-token');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function issueAccessToken(userId) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

function profilePayload() {
  return {
    id: 77,
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1 415 555 0100',
    countryCode: 'US',
    availableCountryCodes: ['US'],
    avatarUrl: 'https://cdn.example.com/avatars/77.jpg',
    passwordLastUpdatedAt: '2026-08-19 12:00:00',
    delivery: {
      address: '123 Market St',
      complement: 'Apt 4',
      city: 'San Francisco',
      state: 'CALIFORNIA',
      zipCode: '94103',
      deliveryInstructions: 'Leave at door'
    },
    accountStatus: {
      hasActiveSubscription: false,
      canDeleteAccount: true,
      deleteRestrictionMessage: null
    }
  };
}

describe('profile routes', () => {
  test('returns the authenticated profile', async () => {
    const profileService = {
      getProfile: jest.fn().mockResolvedValue(profilePayload())
    };
    const app = createApp({ profileService, corsOrigins, jwt });

    const response = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${issueAccessToken(77)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: profilePayload() });
    expect(profileService.getProfile).toHaveBeenCalledWith({ userId: 77 });
  });

  test('requires a bearer token', async () => {
    const profileService = { getProfile: jest.fn() };
    const app = createApp({ profileService, corsOrigins, jwt });

    const response = await request(app).get('/api/v1/profile');

    expect(response.status).toBe(401);
    expect(response.body.details.code).toBe('unauthorized');
    expect(profileService.getProfile).not.toHaveBeenCalled();
  });

  test('rejects a malformed jwt before the handler', async () => {
    const profileService = { getProfile: jest.fn() };
    const app = createApp({ profileService, corsOrigins, jwt });

    const response = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', 'Bearer not-a-jwt');

    expect(response.status).toBe(403);
    expect(String(response.body.details.code)).toMatch(/^jwt_auth_/);
    expect(profileService.getProfile).not.toHaveBeenCalled();
  });

  test('updates personal info over PUT and PATCH', async () => {
    const profileService = {
      updatePersonal: jest.fn().mockResolvedValue({
        fullName: 'Jane Doe',
        phone: '+1 415 555 0100',
        countryCode: 'US',
        availableCountryCodes: ['US'],
        avatarUrl: null
      })
    };
    const app = createApp({ profileService, corsOrigins, jwt });
    const payload = { fullName: 'Jane Doe', phone: '', countryCode: 'US', avatarUrl: null };

    const putResponse = await request(app)
      .put('/api/v1/profile/personal')
      .set('Authorization', `Bearer ${issueAccessToken(77)}`)
      .send(payload);

    expect(putResponse.status).toBe(200);
    expect(putResponse.body.data.fullName).toBe('Jane Doe');

    const patchResponse = await request(app)
      .patch('/api/v1/profile/personal')
      .set('Authorization', `Bearer ${issueAccessToken(77)}`)
      .send(payload);

    expect(patchResponse.status).toBe(200);
    expect(profileService.updatePersonal).toHaveBeenCalledTimes(2);
  });

  test('returns field validation errors from the service', async () => {
    const profileService = {
      updatePersonal: jest.fn().mockRejectedValue(
        new HttpError(422, 'Full name is required.', { code: 'validation_error', field: 'fullName' })
      )
    };
    const app = createApp({ profileService, corsOrigins, jwt });

    const response = await request(app)
      .put('/api/v1/profile/personal')
      .set('Authorization', `Bearer ${issueAccessToken(77)}`)
      .send({ fullName: '' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      success: false,
      message: 'Full name is required.',
      details: { code: 'validation_error', field: 'fullName' }
    });
  });

  test('updates delivery, email, password and avatar', async () => {
    const profileService = {
      updateDelivery: jest.fn().mockResolvedValue({
        address: '123 Market St',
        complement: 'Apt 4',
        city: 'San Francisco',
        state: 'CALIFORNIA',
        zipCode: '94103',
        deliveryInstructions: 'Leave at door'
      }),
      changeEmail: jest.fn().mockResolvedValue({ email: 'jane.new@example.com' }),
      changePassword: jest.fn().mockResolvedValue({ passwordLastUpdatedAt: '2026-08-19 12:00:00' }),
      uploadAvatar: jest.fn().mockResolvedValue({ avatarUrl: 'https://cdn.example.com/avatars/avatar-77-abc.jpg' })
    };
    const app = createApp({ profileService, corsOrigins, jwt });
    const token = issueAccessToken(77);

    const delivery = await request(app)
      .put('/api/v1/profile/delivery')
      .set('Authorization', `Bearer ${token}`)
      .send({ address: '123 Market St', city: 'San Francisco', state: 'CA', zipCode: '94103' });
    expect(delivery.status).toBe(200);
    expect(delivery.body.data.state).toBe('CALIFORNIA');

    const email = await request(app)
      .put('/api/v1/profile/email')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'old-secret', newEmail: 'jane.new@example.com' });
    expect(email.body.data.email).toBe('jane.new@example.com');

    const password = await request(app)
      .put('/api/v1/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'old-secret', newPassword: 'new-secret', confirmPassword: 'new-secret' });
    expect(password.body.data.passwordLastUpdatedAt).toBe('2026-08-19 12:00:00');

    const avatar = await request(app)
      .post('/api/v1/profile/avatar')
      .set('Authorization', `Bearer ${token}`)
      .send({ imageBase64: 'abc', mimeType: 'image/jpeg' });
    expect(avatar.status).toBe(200);
    expect(avatar.body.data.avatarUrl).toContain('avatar-77');
  });

  test('deletes the account and maps a blocked subscription', async () => {
    const profileService = {
      deleteAccount: jest.fn()
        .mockResolvedValueOnce({ deleted: true })
        .mockRejectedValueOnce(new HttpError(422, 'You have an active subscription. Please cancel it before deleting your account.', {
          code: 'active_subscription'
        }))
    };
    const app = createApp({ profileService, corsOrigins, jwt });
    const token = issueAccessToken(77);

    const deleted = await request(app)
      .delete('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ deleted: true });

    const blocked = await request(app)
      .delete('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.details.code).toBe('active_subscription');
  });

  test('does not call delete without a bearer token', async () => {
    const profileService = { deleteAccount: jest.fn() };
    const app = createApp({ profileService, corsOrigins, jwt });

    const response = await request(app).delete('/api/v1/profile');

    expect(response.status).toBe(401);
    expect(profileService.deleteAccount).not.toHaveBeenCalled();
  });
});
