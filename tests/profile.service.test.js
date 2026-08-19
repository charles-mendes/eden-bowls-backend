const { ProfileService } = require('../src/services/profile.service');
const { HttpError } = require('../src/core/http-error');

const JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9, 0x00, 0x10]);
const JPEG_BASE64 = JPEG_BYTES.toString('base64');

function createUser(overrides = {}) {
  return {
    id: 77,
    userLogin: 'jane',
    email: 'jane@example.com',
    displayName: 'Jane Doe',
    userPass: 'hashed-pass',
    phone: '+1 415 555 0100',
    phoneCountry: 'US',
    avatarUrl: 'https://cdn.example.com/avatars/77.jpg',
    passwordLastUpdatedAt: '2026-08-19 12:00:00',
    marketCountry: '',
    activationStatus: 'active',
    ...overrides
  };
}

function createService(overrides = {}) {
  const repository = {
    findUserById: jest.fn().mockResolvedValue(createUser()),
    getAddress: jest.fn().mockResolvedValue({
      exists: true,
      address: {
        street: '123 Market St',
        complement: 'Apt 4',
        city: 'San Francisco',
        state: 'CA',
        zipcode: '94103',
        delivery_instructions: 'Leave at door',
        country: 'US',
        phone: '+1 415 555 0100',
        phone_country: 'US',
        neighborhood: 'SOMA',
        number: '123'
      }
    }),
    mergeAddress: jest.fn().mockImplementation(async (_userId, patch) => ({
      street: '123 Market St',
      complement: 'Apt 4',
      city: 'San Francisco',
      state: 'NY',
      zipcode: '94103',
      delivery_instructions: 'Leave at door',
      country: 'US',
      phone: '+1 415 555 0100',
      phone_country: 'US',
      ...patch
    })),
    updateDisplayName: jest.fn().mockResolvedValue(undefined),
    upsertUserMeta: jest.fn().mockResolvedValue(undefined),
    getUserMeta: jest.fn().mockResolvedValue('https://cdn.example.com/avatars/77.jpg'),
    updateUserEmail: jest.fn().mockResolvedValue(undefined),
    findUserIdByEmail: jest.fn().mockResolvedValue(77),
    updateUserPassword: jest.fn().mockResolvedValue(undefined),
    softDeletePetsByUserId: jest.fn().mockResolvedValue(undefined),
    deleteUserState: jest.fn().mockResolvedValue(undefined),
    deleteUserAndMeta: jest.fn().mockResolvedValue(undefined),
    ...overrides.repository
  };

  const authService = {
    assertCriticalOperationAllowed: jest.fn().mockResolvedValue({ id: 77 }),
    ...overrides.authService
  };

  const ledgerRepository = {
    hasActiveSubscription: jest.fn().mockResolvedValue(false),
    listByUserId: jest.fn().mockResolvedValue([]),
    ...overrides.ledgerRepository
  };

  const refreshTokenRepository = {
    revokeAllForUser: jest.fn().mockResolvedValue(1),
    ...overrides.refreshTokenRepository
  };

  const stripeBilling = {
    cancelSubscriptionImmediately: jest.fn().mockResolvedValue({ status: 'canceled' }),
    ...overrides.stripeBilling
  };

  const avatarStorage = {
    write: jest.fn().mockResolvedValue('https://cdn.example.com/avatars/avatar-77-abc.jpg'),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides.avatarStorage
  };

  const service = new ProfileService(repository, {
    authService,
    ledgerRepository,
    refreshTokenRepository,
    stripeBilling,
    avatarStorage,
    hashPassword: (value) => `hashed:${value}`,
    verifyPassword: (password, hash) => password === 'old-secret' && hash === 'hashed-pass',
    nowProvider: () => new Date('2026-08-19T12:00:00.000Z'),
    ...overrides.options
  });

  return {
    service,
    repository,
    authService,
    ledgerRepository,
    refreshTokenRepository,
    stripeBilling,
    avatarStorage
  };
}

describe('ProfileService', () => {
  test('maps CA to CALIFORNIA and keeps BR/US country lock', async () => {
    const { service } = createService();
    const profile = await service.getProfile({ userId: 77 });

    expect(profile.delivery.state).toBe('CALIFORNIA');
    expect(profile.countryCode).toBe('US');
    expect(profile.availableCountryCodes).toEqual(['US']);
    expect(profile.avatarUrl).toBe('https://cdn.example.com/avatars/77.jpg');
    expect(profile.accountStatus).toEqual({
      hasActiveSubscription: false,
      canDeleteAccount: true,
      deleteRestrictionMessage: null
    });
  });

  test('uppercases a Brazilian state and returns empty delivery when address is missing', async () => {
    const withBr = createService({
      repository: {
        findUserById: jest.fn().mockResolvedValue(createUser({ phoneCountry: 'BR' })),
        getAddress: jest.fn().mockResolvedValue({
          exists: true,
          address: { street: 'Rua A', city: 'Sao Paulo', state: 'sp', zipcode: '01310100', country: 'BR' }
        })
      }
    });
    const brProfile = await withBr.service.getProfile({ userId: 77 });
    expect(brProfile.delivery.state).toBe('SP');

    const missing = createService({
      repository: {
        findUserById: jest.fn().mockResolvedValue(createUser({ phoneCountry: '', avatarUrl: '' })),
        getAddress: jest.fn().mockResolvedValue({ exists: false, address: null })
      }
    });
    const emptyProfile = await missing.service.getProfile({ userId: 77 });
    expect(emptyProfile.delivery).toEqual({
      address: '',
      complement: '',
      city: '',
      state: '',
      zipCode: '',
      deliveryInstructions: ''
    });
    expect(emptyProfile.avatarUrl).toBeNull();
    expect(emptyProfile.availableCountryCodes).toEqual(['BR', 'US']);
  });

  test('treats trialing and a missing ledger table as blocking delete', async () => {
    const trialing = createService({
      ledgerRepository: { hasActiveSubscription: jest.fn().mockResolvedValue(true) }
    });
    await expect(trialing.service.getProfile({ userId: 77 })).resolves.toMatchObject({
      accountStatus: {
        hasActiveSubscription: true,
        canDeleteAccount: false,
        deleteRestrictionMessage: 'You have an active subscription. Please cancel it before deleting your account.'
      }
    });

    const missingTable = createService({
      ledgerRepository: { hasActiveSubscription: jest.fn().mockResolvedValue(null) }
    });
    await expect(missingTable.service.getProfile({ userId: 77 })).resolves.toMatchObject({
      accountStatus: { canDeleteAccount: false, hasActiveSubscription: true }
    });
  });

  test('rejects a pending account on GET', async () => {
    const { service } = createService({
      repository: {
        findUserById: jest.fn().mockResolvedValue(createUser({ activationStatus: 'pending' }))
      }
    });

    await expect(service.getProfile({ userId: 77 })).rejects.toMatchObject({
      statusCode: 401,
      details: { code: 'unauthorized' }
    });
  });

  test('rejects an empty fullName and coerces an unavailable country without 422', async () => {
    const { service, repository } = createService();

    await expect(service.updatePersonal({ userId: 77, payload: { fullName: '   ' } })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'validation_error', field: 'fullName' }
    });

    const result = await service.updatePersonal({
      userId: 77,
      payload: { fullName: 'Jane Doe', countryCode: 'br', phone: '+1 415 555 0100' }
    });
    expect(result.countryCode).toBe('US');
    expect(result.availableCountryCodes).toEqual(['US']);
    expect(repository.upsertUserMeta).toHaveBeenCalledWith(77, '_eden_phone_country', 'US');
  });

  test('clears avatar on null, ignores empty string, and lowercases countryCode', async () => {
    const unlocked = createService({
      repository: {
        findUserById: jest.fn().mockResolvedValue(createUser({ phoneCountry: '' })),
        getAddress: jest.fn().mockResolvedValue({ exists: false, address: null }),
        getUserMeta: jest.fn().mockResolvedValue('https://cdn.example.com/avatars/keep.jpg')
      }
    });

    const cleared = await unlocked.service.updatePersonal({
      userId: 77,
      payload: { fullName: 'Jane', countryCode: 'br', avatarUrl: null }
    });
    expect(cleared.countryCode).toBe('BR');
    expect(cleared.avatarUrl).toBeNull();
    expect(unlocked.repository.upsertUserMeta).toHaveBeenCalledWith(77, '_eden_avatar_url', '');

    unlocked.repository.upsertUserMeta.mockClear();
    const ignored = await unlocked.service.updatePersonal({
      userId: 77,
      payload: { fullName: 'Jane', avatarUrl: '' }
    });
    expect(ignored.avatarUrl).toBe('https://cdn.example.com/avatars/keep.jpg');
    expect(unlocked.repository.upsertUserMeta.mock.calls.some((call) => call[1] === '_eden_avatar_url')).toBe(false);
  });

  test('stores Nova Iorque as NY and returns NEW YORK, while preserving phone and country', async () => {
    const { service, repository } = createService();
    const result = await service.updateDelivery({
      userId: 77,
      payload: {
        address: '123 Market St',
        complement: '',
        city: 'New York',
        state: 'Nova Iorque',
        zipCode: '10001',
        deliveryInstructions: 'Ring bell'
      }
    });

    expect(result.state).toBe('NEW YORK');
    expect(repository.mergeAddress).toHaveBeenCalledWith(77, expect.objectContaining({
      state: 'NY',
      complement: '',
      zipcode: '10001'
    }), { createIfMissing: true });
    const patch = repository.mergeAddress.mock.calls[0][1];
    expect(patch.phone).toBeUndefined();
    expect(patch.country).toBeUndefined();
  });

  test('uppercases a BR state and rejects a short US ZIP', async () => {
    const br = createService({
      repository: {
        findUserById: jest.fn().mockResolvedValue(createUser({ phoneCountry: 'BR' })),
        getAddress: jest.fn().mockResolvedValue({ exists: true, address: { country: 'BR', phone: '1199999' } }),
        mergeAddress: jest.fn().mockResolvedValue({
          street: 'Rua A',
          city: 'Sao Paulo',
          state: 'SP',
          zipcode: '01310100',
          country: 'BR'
        })
      }
    });
    const saved = await br.service.updateDelivery({
      userId: 77,
      payload: { address: 'Rua A', city: 'Sao Paulo', state: 'sp', zipCode: '01310-100' }
    });
    expect(saved.state).toBe('SP');
    expect(br.repository.mergeAddress.mock.calls[0][1].state).toBe('SP');

    const us = createService();
    await expect(us.service.updateDelivery({
      userId: 77,
      payload: { address: '123 Market St', city: 'San Francisco', state: 'CA', zipCode: '9410' }
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_zipcode' }
    });
  });

  test('requires zipCode and does not create state only from personal phone', async () => {
    const { service, repository } = createService();
    await expect(service.updateDelivery({
      userId: 77,
      payload: { address: '123 Market St', city: 'San Francisco', state: 'CA' }
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'validation_error', errors: { zipCode: 'This field is required.' } }
    });

    const noState = createService({
      repository: {
        getAddress: jest.fn().mockResolvedValue({ exists: false, address: null })
      }
    });
    await noState.service.updatePersonal({ userId: 77, payload: { fullName: 'Jane', phone: '123' } });
    expect(noState.repository.mergeAddress).not.toHaveBeenCalled();
  });

  test('accepts the current email and rejects another user or a missing password', async () => {
    const own = createService();
    await expect(own.service.changeEmail({
      userId: 77,
      payload: { currentPassword: 'old-secret', newEmail: 'jane@example.com' }
    })).resolves.toEqual({ email: 'jane@example.com' });
    expect(own.repository.updateUserEmail).not.toHaveBeenCalled();

    const taken = createService({
      repository: { findUserIdByEmail: jest.fn().mockResolvedValue(88) }
    });
    await expect(taken.service.changeEmail({
      userId: 77,
      payload: { currentPassword: 'old-secret', newEmail: 'other@example.com' }
    })).rejects.toMatchObject({ details: { code: 'email_taken', field: 'newEmail' } });

    await expect(own.service.changeEmail({
      userId: 77,
      payload: { currentPassword: '', newEmail: 'jane.new@example.com' }
    })).rejects.toMatchObject({ details: { code: 'validation_error', field: 'currentPassword' } });

    await expect(own.service.changeEmail({
      userId: 77,
      payload: { currentPassword: 'nope', newEmail: 'jane.new@example.com' }
    })).rejects.toMatchObject({ details: { code: 'invalid_password', field: 'currentPassword' } });

    await expect(own.service.changeEmail({
      userId: 77,
      payload: { currentPassword: 'old-secret', newEmail: 'not-an-email' }
    })).rejects.toMatchObject({ details: { code: 'validation_error', field: 'newEmail' } });
  });

  test('rejects password mismatch, short secrets, and revokes refresh tokens on success', async () => {
    const { service, repository, refreshTokenRepository } = createService();

    await expect(service.changePassword({
      userId: 77,
      payload: { currentPassword: 'old-secret', newPassword: 'new-secret', confirmPassword: 'other' }
    })).rejects.toMatchObject({ details: { code: 'password_mismatch', field: 'confirmPassword' } });

    await expect(service.changePassword({
      userId: 77,
      payload: { currentPassword: 'old-secret', newPassword: '1234567', confirmPassword: '1234567' }
    })).rejects.toMatchObject({ details: { code: 'validation_error', field: 'newPassword' } });

    const result = await service.changePassword({
      userId: 77,
      payload: { currentPassword: 'old-secret', newPassword: 'new-secret', confirmPassword: 'new-secret' }
    });
    expect(result.passwordLastUpdatedAt).toBe('2026-08-19 12:00:00');
    expect(repository.updateUserPassword).toHaveBeenCalledWith(77, 'hashed:new-secret');
    expect(repository.upsertUserMeta).toHaveBeenCalledWith(77, '_eden_pwd_updated_at', '2026-08-19 12:00:00');
    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(77, 'password_changed', '2026-08-19 12:00:00');
  });

  test('rejects data-URI, gif, oversized images, and deletes the previous avatar on upload', async () => {
    const { service, avatarStorage, repository } = createService();

    await expect(service.uploadAvatar({
      userId: 77,
      payload: { imageBase64: `data:image/jpeg;base64,${JPEG_BASE64}`, mimeType: 'image/jpeg' }
    })).rejects.toMatchObject({ details: { code: 'invalid_image' } });

    await expect(service.uploadAvatar({
      userId: 77,
      payload: { imageBase64: JPEG_BASE64, mimeType: 'image/gif' }
    })).rejects.toMatchObject({ details: { code: 'invalid_mime' } });

    const huge = Buffer.alloc((3 * 1024 * 1024) + 1, 0);
    huge[0] = 0xFF;
    huge[1] = 0xD8;
    huge[2] = 0xFF;
    await expect(service.uploadAvatar({
      userId: 77,
      payload: { imageBase64: huge.toString('base64'), mimeType: 'image/jpeg' }
    })).rejects.toMatchObject({ details: { code: 'image_too_large' } });

    const uploaded = await service.uploadAvatar({
      userId: 77,
      payload: { imageBase64: JPEG_BASE64 }
    });
    expect(uploaded.avatarUrl).toContain('avatar-77');
    expect(avatarStorage.write).toHaveBeenCalledWith(expect.objectContaining({ userId: 77, ext: 'jpg' }));
    expect(avatarStorage.delete).toHaveBeenCalledWith('https://cdn.example.com/avatars/77.jpg');
    expect(repository.upsertUserMeta).toHaveBeenCalledWith(77, '_eden_avatar_url', uploaded.avatarUrl);
  });

  test('blocks delete for active, trialing, and missing ledger, and cancels leftover incomplete subs', async () => {
    const active = createService({
      ledgerRepository: { hasActiveSubscription: jest.fn().mockResolvedValue(true) }
    });
    await expect(active.service.deleteAccount({ userId: 77 })).rejects.toMatchObject({
      details: { code: 'active_subscription' }
    });

    const missingTable = createService({
      ledgerRepository: { hasActiveSubscription: jest.fn().mockResolvedValue(null) }
    });
    await expect(missingTable.service.deleteAccount({ userId: 77 })).rejects.toMatchObject({
      details: { code: 'active_subscription' }
    });

    const leftover = createService({
      ledgerRepository: {
        hasActiveSubscription: jest.fn().mockResolvedValue(false),
        listByUserId: jest.fn().mockResolvedValue([
          { stripeSubscriptionId: 'sub_incomplete', status: 'incomplete' },
          { stripeSubscriptionId: 'sub_done', status: 'cancelled' }
        ])
      }
    });
    await expect(leftover.service.deleteAccount({ userId: 77 })).resolves.toEqual({ deleted: true });
    expect(leftover.stripeBilling.cancelSubscriptionImmediately).toHaveBeenCalledWith('sub_incomplete');
    expect(leftover.stripeBilling.cancelSubscriptionImmediately).not.toHaveBeenCalledWith('sub_done');
    expect(leftover.refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(77, 'account_deleted', expect.any(String));
    expect(leftover.repository.softDeletePetsByUserId).toHaveBeenCalled();
    expect(leftover.repository.deleteUserAndMeta).toHaveBeenCalledWith(77);
  });

  test('returns 401 when the user is already gone', async () => {
    const { service, authService } = createService({
      repository: { findUserById: jest.fn().mockResolvedValue(null) }
    });

    await expect(service.deleteAccount({ userId: 77 })).rejects.toMatchObject({
      statusCode: 401,
      details: { code: 'unauthorized' }
    });
    expect(authService.assertCriticalOperationAllowed).not.toHaveBeenCalled();
  });
});
