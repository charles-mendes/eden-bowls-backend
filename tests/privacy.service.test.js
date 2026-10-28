const { PrivacyService } = require('../src/services/privacy.service');
const { HttpError } = require('../src/core/http-error');
const LEGAL_PRIVACY_VERSION = '2026-09-13';
const LEGAL_TERMS_VERSION = '2026-09-13';
const { dueAtForMarket } = require('../src/core/privacy');

const NOW = new Date('2026-01-01T00:00:00.000Z');

function requestRow(overrides = {}) {
  return {
    id: 11,
    userId: 77,
    type: 'correction',
    status: 'open',
    market: 'BR',
    locale: 'pt-BR',
    payload: {},
    resultNote: null,
    dueAt: dueAtForMarket(NOW, 'BR').toISOString(),
    extendedAt: null,
    extensionReason: null,
    identityStatus: 'verified_session',
    identityVerifiedAt: NOW.toISOString(),
    channel: 'in_app',
    resolvedAt: null,
    resolvedBy: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    overdue: false,
    ...overrides
  };
}

function createService(overrides = {}) {
  const stored = [];
  const repository = {
    insertConsent: jest.fn().mockImplementation(async (input) => {
      const row = { id: stored.length + 1, ...input };
      stored.push(row);
      return row;
    }),
    listConsentsForUser: jest.fn().mockResolvedValue([]),
    getLatestCookiePreferences: jest.fn().mockResolvedValue({ analytics: 'granted', ads: 'denied' }),
    insertRequest: jest.fn().mockImplementation(async (input) => requestRow({
      ...input,
      dueAt: input.dueAt instanceof Date ? input.dueAt.toISOString() : input.dueAt,
      createdAt: input.createdAt instanceof Date ? input.createdAt.toISOString() : input.createdAt,
      resolvedAt: input.resolvedAt instanceof Date ? input.resolvedAt.toISOString() : input.resolvedAt,
      identityVerifiedAt: input.identityVerifiedAt instanceof Date ? input.identityVerifiedAt.toISOString() : input.identityVerifiedAt
    })),
    findRequestById: jest.fn(),
    updateRequest: jest.fn().mockImplementation(async (id, patch) => requestRow({ id, ...patch })),
    listRequestsForUser: jest.fn().mockResolvedValue([]),
    listRequests: jest.fn().mockResolvedValue({ total: 0, items: [] }),
    listActivePets: jest.fn().mockResolvedValue([]),
    listSubscriptionSummary: jest.fn().mockResolvedValue([]),
    findRequestByIdentityTokenHash: jest.fn(),
    hardDeletePetsByUserId: jest.fn(),
    ...overrides.repository
  };

  const profileRepository = {
    getUserMeta: jest.fn().mockResolvedValue('0'),
    upsertUserMeta: jest.fn().mockResolvedValue(undefined),
    findUserById: jest.fn().mockResolvedValue({ id: 77, email: 'jane@example.com', marketCountry: 'BR' }),
    ...overrides.profileRepository
  };

  const profileService = {
    getProfile: jest.fn().mockResolvedValue({
      id: 77,
      fullName: 'Jane',
      email: 'jane@example.com',
      phone: '',
      countryCode: 'BR',
      delivery: {},
      marketingOptIn: false,
      cookiePreferences: { analytics: 'granted', ads: 'denied' }
    }),
    deleteAccount: jest.fn().mockResolvedValue({ deleted: true }),
    ...overrides.profileService
  };

  const service = new PrivacyService({
    repository,
    profileRepository,
    profileService,
    nowProvider: () => NOW,
    publicBaseUrl: 'https://www.edenbowls.com',
    ...overrides.options
  });

  return { service, repository, profileRepository, profileService };
}

describe('PrivacyService', () => {
  test('records OTP consents with document versions and marketing default denied', async () => {
    const { service, repository } = createService();

    await service.recordOtpConsents({
      userId: 77,
      marketingOptIn: false,
      privacyVersion: LEGAL_PRIVACY_VERSION,
      termsVersion: LEGAL_TERMS_VERSION,
      ipHash: 'abc',
      userAgent: 'jest'
    });

    expect(repository.insertConsent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      consentType: 'privacy_policy',
      status: 'granted',
      documentVersion: LEGAL_PRIVACY_VERSION,
      source: 'otp_verify'
    }));
    expect(repository.insertConsent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      consentType: 'terms',
      documentVersion: LEGAL_TERMS_VERSION
    }));
    expect(repository.insertConsent).toHaveBeenNthCalledWith(3, expect.objectContaining({
      consentType: 'marketing_email',
      status: 'denied'
    }));
  });

  describe('consent versions of the published legal documents', () => {
    // BR terms 2026-09-13 and 2026-11-01 (current); privacy 2026-09-13 only.
    const published = { 'BR:terms': ['2026-09-13', '2026-11-01'], 'BR:privacy': ['2026-09-13'], 'US:terms': ['2026-09-13'], 'US:privacy': ['2026-09-13'] };
    const legalDocuments = {
      isPublished: jest.fn(async (market, kind, version) => published[`${market}:${kind}`].includes(version)),
      currentVersion: jest.fn(async (market, kind) => published[`${market}:${kind}`].slice(-1)[0])
    };
    const versions = (repository) => repository.insertConsent.mock.calls.slice(0, 2).map(([input]) => input.documentVersion);

    test('Customer accepts the version shown', async () => {
      const { service, repository } = createService({ options: { legalDocuments } });
      await service.recordOtpConsents({ userId: 77, privacyVersion: '2026-09-13', termsVersion: '2026-09-13', market: 'BR' });
      expect(versions(repository)).toEqual(['2026-09-13', '2026-09-13']);
    });

    test('without a version the current one of the market is recorded', async () => {
      const { service, repository } = createService({ options: { legalDocuments } });
      await service.recordOtpConsents({ userId: 77, market: 'BR' });
      expect(versions(repository)).toEqual(['2026-09-13', '2026-11-01']);
    });

    test('Stale client sends an unknown version', async () => {
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const { service, repository } = createService({ options: { legalDocuments, logger } });

      await expect(service.recordOtpConsents({ userId: 77, privacyVersion: '2020-01-01', termsVersion: '2026-11-01', market: 'BR' })).resolves.toBeUndefined();

      expect(versions(repository)).toEqual(['2026-09-13', '2026-11-01']);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toEqual({ market: 'BR', kind: 'privacy', received: '2020-01-01', recorded: '2026-09-13' });
    });

    test('a version of another market is not recorded: a consent without market reads as US', async () => {
      const { service, repository } = createService({ options: { legalDocuments } });
      await service.recordOtpConsents({ userId: 77, termsVersion: '2026-11-01' });
      expect(versions(repository)).toEqual(['2026-09-13', '2026-09-13']);
    });
  });

  test('sets due_at to 15 days for BR and 45 days for US', async () => {
    const { service, repository } = createService();

    await service.createCustomerRequest({ userId: 77, type: 'correction', market: 'BR' });
    expect(repository.insertRequest).toHaveBeenCalledWith(expect.objectContaining({
      dueAt: new Date('2026-01-16T00:00:00.000Z'),
      identityStatus: 'verified_session'
    }));

    repository.insertRequest.mockClear();
    await service.createCustomerRequest({ userId: 77, type: 'correction', market: 'US' });
    expect(repository.insertRequest).toHaveBeenCalledWith(expect.objectContaining({
      dueAt: new Date('2026-02-15T00:00:00.000Z')
    }));
  });

  test('extends a request once and blocks a second extension', async () => {
    const row = requestRow({ dueAt: '2026-01-16T00:00:00.000Z' });
    const { service, repository } = createService({
      repository: {
        findRequestById: jest.fn()
          .mockResolvedValueOnce(row)
          .mockResolvedValueOnce(requestRow({ ...row, extendedAt: NOW.toISOString(), dueAt: '2026-01-31T00:00:00.000Z' }))
          .mockResolvedValue(requestRow({ ...row, extendedAt: NOW.toISOString(), dueAt: '2026-01-31T00:00:00.000Z' }))
      }
    });

    const extended = await service.extendOnce(11, 'volume alto', 7);
    expect(repository.updateRequest).toHaveBeenCalledWith(11, expect.objectContaining({
      dueAt: new Date('2026-01-31T00:00:00.000Z'),
      extensionReason: 'volume alto'
    }));
    expect(extended.extensionReason || 'volume alto').toBeTruthy();

    await expect(service.extendOnce(11, 'again', 7)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'already_extended' }
    });
  });

  test('does not complete access, deletion or portability while identity is unverified', async () => {
    const { service } = createService({
      repository: {
        findRequestById: jest.fn().mockResolvedValue(requestRow({
          type: 'access',
          identityStatus: 'unverified',
          channel: 'email'
        }))
      }
    });

    await expect(service.completeRequest(11, 'ok', 7)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'identity_unverified' }
    });
  });

  test('leaves deletion open when the account still has an active subscription', async () => {
    const { service, profileService, repository } = createService({
      profileService: {
        deleteAccount: jest.fn().mockRejectedValue(new HttpError(422, 'active', { code: 'active_subscription' }))
      }
    });

    await expect(service.createCustomerRequest({ userId: 77, type: 'deletion', market: 'BR' })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'active_subscription' }
    });
    expect(profileService.deleteAccount).toHaveBeenCalledWith({ userId: 77 });
    expect(repository.insertRequest).toHaveBeenCalledWith(expect.objectContaining({
      type: 'deletion',
      status: 'open'
    }));
  });

  test('forces ads denied when saving cookie preferences', async () => {
    const { service } = createService();
    const result = await service.setCookies({
      userId: 77,
      analytics: 'granted',
      ads: 'granted',
      source: 'preferences'
    });
    expect(result).toEqual({ analytics: 'granted', ads: 'denied' });
  });

  test('hides a US privacy request and snapshot from a Brazil operator', async () => {
    const { service } = createService({
      repository: {
        findRequestById: jest.fn().mockResolvedValue(requestRow({ market: 'US' }))
      },
      profileRepository: {
        findUserById: jest.fn().mockResolvedValue({ id: 91, email: 'us@edenbowls.com', marketCountry: 'US' })
      }
    });
    const actor = { roles: ['operator'], markets: ['BR'] };

    await expect(service.getAdminRequest(91, actor)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.getUserPrivacySnapshot(91, actor)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('PrivacyService customer note', () => {
  test('lists the note and lets the customer reword an open request', async () => {
    const { service, repository } = createService();
    repository.findRequestById.mockResolvedValue(requestRow({ payload: { note: 'old' } }));

    const updated = await service.updateOwnRequestNote({ userId: 77, requestId: 11, note: 'Meu CEP mudou' });

    expect(repository.updateRequest).toHaveBeenCalledWith(11, { payload: { note: 'Meu CEP mudou' } });
    expect(updated).toMatchObject({ id: 11, note: 'Meu CEP mudou', editable: true });
  });

  test('keeps the export package when the note changes', async () => {
    const { service, repository } = createService();
    repository.findRequestById.mockResolvedValue(requestRow({ status: 'in_progress', payload: { note: 'a', identityTokenHash: 'h' } }));

    await service.updateOwnRequestNote({ userId: 77, requestId: 11, note: 'b' });

    expect(repository.updateRequest).toHaveBeenCalledWith(11, { payload: { note: 'b', identityTokenHash: 'h' } });
  });

  test('refuses a closed request and another customer\'s request', async () => {
    const { service, repository } = createService();
    repository.findRequestById.mockResolvedValue(requestRow({ status: 'completed' }));
    await expect(service.updateOwnRequestNote({ userId: 77, requestId: 11, note: 'x' }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'request_closed' } });

    repository.findRequestById.mockResolvedValue(requestRow());
    await expect(service.updateOwnRequestNote({ userId: 78, requestId: 11, note: 'x' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(repository.updateRequest).not.toHaveBeenCalled();
  });
});
