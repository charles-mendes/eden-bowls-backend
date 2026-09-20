const crypto = require('crypto');
const { HttpError } = require('../core/http-error');
const { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } = require('../core/legal-documents');
const {
  dueAtForMarket,
  hashIp,
  truncateUserAgent,
  isIdentityVerified,
  isTerminalStatus,
  slaDaysForMarket,
  addCalendarDays,
  normalizeMarket,
  TYPES_REQUIRING_IDENTITY_TO_COMPLETE
} = require('../core/privacy');
const { STRIPE_ACCOUNTS } = require('../core/stripe-account');
const { resolveStripeBilling } = require('../infrastructure/stripe/stripe-accounts');
const {
  constrainMarketQuery,
  assertRecordMarket,
  shouldEnforceMarketScope
} = require('../core/admin-market-scope');

function redactExportPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const { package: pack, identityToken, identityTokenHash, ...rest } = payload;
  return {
    ...rest,
    hasPackage: Boolean(pack)
  };
}

function presentOwnRequest(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    market: row.market,
    dueAt: row.dueAt,
    overdue: row.overdue,
    identityStatus: row.identityStatus,
    channel: row.channel,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resultNote: row.resultNote
  };
}

class PrivacyService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.profileService = options.profileService || null;
    this.profileRepository = options.profileRepository || null;
    this.quotesRepository = options.quotesRepository || null;
    this.customerStore = options.customerStore || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.mailer = options.mailer || null;
    this.publicBaseUrl = String(options.publicBaseUrl || '').replace(/\/+$/, '');
    this.ipPepper = String(options.ipPepper || '');
    this.logger = options.logger || { info() {}, error() {} };
    this.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => new Date();
  }

  now() {
    const value = this.nowProvider();
    return value instanceof Date ? value : new Date(value);
  }

  ensureRepository() {
    if (!this.repository) {
      throw new HttpError(503, 'Privacy repository is not available.');
    }
  }

  contextFromRequest(request = {}) {
    return {
      ipHash: hashIp(request.ip || request.clientIp || '', this.ipPepper),
      userAgent: truncateUserAgent(request.userAgent || (request.headers && request.headers['user-agent']))
    };
  }

  async recordConsent(input) {
    this.ensureRepository();
    return this.repository.insertConsent({
      userId: input.userId || null,
      consentType: input.consentType,
      status: input.status,
      documentVersion: input.documentVersion || null,
      source: input.source,
      ipHash: input.ipHash || '',
      userAgent: input.userAgent || '',
      createdAt: input.createdAt || this.now()
    });
  }

  async recordOtpConsents({ userId, marketingOptIn, privacyVersion, termsVersion, ipHash, userAgent }) {
    const context = { ipHash: ipHash || '', userAgent: userAgent || '' };
    await this.recordConsent({
      userId,
      consentType: 'privacy_policy',
      status: 'granted',
      documentVersion: privacyVersion || LEGAL_PRIVACY_VERSION,
      source: 'otp_verify',
      ...context
    });
    await this.recordConsent({
      userId,
      consentType: 'terms',
      status: 'granted',
      documentVersion: termsVersion || LEGAL_TERMS_VERSION,
      source: 'otp_verify',
      ...context
    });
    await this.recordConsent({
      userId,
      consentType: 'marketing_email',
      status: marketingOptIn ? 'granted' : 'denied',
      source: 'otp_verify',
      ...context
    });
  }

  async listConsents({ userId }) {
    this.ensureRepository();
    return this.repository.listConsentsForUser(userId);
  }

  async getMarketing({ userId }) {
    if (!this.profileRepository || typeof this.profileRepository.getUserMeta !== 'function') {
      throw new HttpError(503, 'Profile repository is not available.');
    }
    const raw = await this.profileRepository.getUserMeta(userId, 'hsr_marketing_opt_in');
    return { marketingOptIn: raw === '1' };
  }

  async setMarketing({ userId, marketingOptIn, source = 'preferences', ipHash, userAgent }) {
    if (!this.profileRepository || typeof this.profileRepository.upsertUserMeta !== 'function') {
      throw new HttpError(503, 'Profile repository is not available.');
    }
    await this.profileRepository.upsertUserMeta(userId, 'hsr_marketing_opt_in', marketingOptIn ? '1' : '0');
    await this.recordConsent({
      userId,
      consentType: 'marketing_email',
      status: marketingOptIn ? 'granted' : 'denied',
      source,
      ipHash,
      userAgent
    });
    return { marketingOptIn: Boolean(marketingOptIn) };
  }

  async getCookiePreferences({ userId }) {
    this.ensureRepository();
    return this.repository.getLatestCookiePreferences(userId);
  }

  async setCookies({ userId, analytics, ads = 'denied', source = 'preferences', ipHash, userAgent }) {
    this.ensureRepository();
    const resolvedAds = 'denied';
    await this.recordConsent({
      userId,
      consentType: 'analytics',
      status: analytics === 'granted' ? 'granted' : 'denied',
      source,
      ipHash,
      userAgent
    });
    await this.recordConsent({
      userId,
      consentType: 'ads',
      status: resolvedAds,
      source,
      ipHash,
      userAgent
    });
    if (source === 'gpc' || source === 'do_not_sell') {
      await this.recordConsent({
        userId,
        consentType: 'share_opt_out',
        status: 'granted',
        source,
        ipHash,
        userAgent
      });
    }
    return { analytics: analytics === 'granted' ? 'granted' : 'denied', ads: resolvedAds };
  }

  async buildExportPackage(userId) {
    if (!this.profileService) {
      throw new HttpError(503, 'Profile service is not available.');
    }
    const profile = await this.profileService.getProfile({ userId });
    const consents = await this.listConsents({ userId });
    const pets = this.repository && typeof this.repository.listActivePets === 'function'
      ? await this.repository.listActivePets(userId)
      : [];
    const subscriptions = this.repository && typeof this.repository.listSubscriptionSummary === 'function'
      ? await this.repository.listSubscriptionSummary(userId)
      : [];

    return {
      exportedAt: this.now().toISOString(),
      profile: {
        id: profile.id,
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        countryCode: profile.countryCode,
        delivery: profile.delivery,
        marketingOptIn: profile.marketingOptIn,
        cookiePreferences: profile.cookiePreferences
      },
      pets: pets.map((pet) => ({
        id: pet.id,
        name: pet.name,
        breed: pet.breed,
        ageYears: Number(pet.age_years || 0),
        ageMonths: Number(pet.age_months || 0),
        weightInput: pet.weight_input,
        weightUnit: pet.weight_unit,
        size: pet.size,
        activityLevel: pet.activity_level,
        petCondition: pet.pet_condition,
        neutered: Boolean(pet.neutered)
      })),
      consents,
      subscriptions
    };
  }

  async createCustomerRequest({ userId, type, market, locale, note, ipHash, userAgent }) {
    this.ensureRepository();
    const now = this.now();
    const normalizedMarket = normalizeMarket(market);
    const identityStatus = 'verified_session';
    const identityVerifiedAt = now;

    if (type === 'opt_out_share') {
      const prefs = await this.repository.getLatestCookiePreferences(userId);
      await this.setCookies({
        userId,
        analytics: prefs.analytics || 'granted',
        ads: 'denied',
        source: 'do_not_sell',
        ipHash,
        userAgent
      });
      const row = await this.repository.insertRequest({
        userId,
        type,
        status: 'completed',
        market: normalizedMarket,
        locale,
        payload: note ? { note } : {},
        dueAt: now,
        identityStatus,
        identityVerifiedAt,
        channel: 'in_app',
        resolvedAt: now,
        createdAt: now
      });
      this.logger.info({ requestId: row.id, userId, type }, 'Privacy request completed immediately.');
      return presentOwnRequest(row);
    }

    const dueAt = dueAtForMarket(now, normalizedMarket);

    if (type === 'access' || type === 'portability') {
      const pack = await this.buildExportPackage(userId);
      const row = await this.repository.insertRequest({
        userId,
        type,
        status: 'completed',
        market: normalizedMarket,
        locale,
        payload: { note: note || null, package: pack },
        dueAt,
        identityStatus,
        identityVerifiedAt,
        channel: 'in_app',
        resolvedAt: now,
        createdAt: now
      });
      this.logger.info({ requestId: row.id, userId, type }, 'Privacy export generated.');
      return { ...presentOwnRequest(row), package: pack };
    }

    if (type === 'deletion') {
      const row = await this.repository.insertRequest({
        userId,
        type,
        status: 'open',
        market: normalizedMarket,
        locale,
        payload: note ? { note } : {},
        dueAt,
        identityStatus,
        identityVerifiedAt,
        channel: 'in_app',
        createdAt: now
      });

      try {
        await this.profileService.deleteAccount({ userId });
        const completed = await this.repository.updateRequest(row.id, {
          status: 'completed',
          resolvedAt: this.now(),
          resultNote: 'Account deleted on the platform.'
        });
        this.logger.info({ requestId: row.id, userId, type }, 'Privacy deletion completed.');
        return presentOwnRequest(completed);
      } catch (error) {
        if (error instanceof HttpError && error.details && error.details.code === 'active_subscription') {
          this.logger.info({ requestId: row.id, userId, type }, 'Privacy deletion left open (active subscription).');
          throw new HttpError(422, error.message, {
            code: 'active_subscription',
            request: presentOwnRequest(row)
          });
        }
        throw error;
      }
    }

    const row = await this.repository.insertRequest({
      userId,
      type,
      status: 'open',
      market: normalizedMarket,
      locale,
      payload: note ? { note } : {},
      dueAt,
      identityStatus,
      identityVerifiedAt,
      channel: 'in_app',
      createdAt: now
    });
    this.logger.info({ requestId: row.id, userId, type }, 'Privacy request opened.');
    return presentOwnRequest(row);
  }

  async listOwnRequests({ userId }) {
    this.ensureRepository();
    const rows = await this.repository.listRequestsForUser(userId);
    return rows.map(presentOwnRequest);
  }

  async downloadOwnPackage({ userId, requestId }) {
    const row = await this.requireOwnedRequest(userId, requestId);
    if (row.type !== 'access' && row.type !== 'portability') {
      throw new HttpError(422, 'This request has no export package.', { code: 'no_export_package' });
    }
    if (!isIdentityVerified(row.identityStatus)) {
      throw new HttpError(422, 'Identity is not verified.', { code: 'identity_unverified' });
    }
    if (row.payload && row.payload.package) {
      return row.payload.package;
    }
    return this.buildExportPackage(userId);
  }

  async requireOwnedRequest(userId, requestId) {
    this.ensureRepository();
    const row = await this.repository.findRequestById(requestId);
    if (!row || Number(row.userId) !== Number(userId)) {
      throw new HttpError(404, 'Privacy request not found.', { code: 'not_found' });
    }
    return row;
  }

  async listAdminRequests(query, pagination, actor = {}) {
    this.ensureRepository();
    const listQuery = { ...query };
    if (shouldEnforceMarketScope(actor)) {
      const scoped = constrainMarketQuery(actor, query);
      if (!(Array.isArray(actor.roles) && actor.roles.includes('admin') && !scoped.filtered)) {
        listQuery.markets = scoped.markets;
      }
    }
    const result = await this.repository.listRequests({ ...listQuery, now: this.now() }, pagination);
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        payload: redactExportPayload(item.payload)
      }))
    };
  }

  async getAdminRequest(id, actor) {
    this.ensureRepository();
    const row = await this.repository.findRequestById(id);
    if (!row) {
      throw new HttpError(404, 'Privacy request not found.', { code: 'not_found' });
    }
    if (shouldEnforceMarketScope(actor)) {
      assertRecordMarket(actor, row.market);
    }
    return {
      ...row,
      payload: redactExportPayload(row.payload)
    };
  }

  async createAdminRequest({ userId, type, market, locale, note, actorId }) {
    this.ensureRepository();
    const user = this.profileRepository
      ? await this.profileRepository.findUserById(userId)
      : null;
    if (!user) {
      throw new HttpError(404, 'User not found.', { code: 'not_found' });
    }
    const now = this.now();
    const normalizedMarket = normalizeMarket(market || user.marketCountry);
    const dueAt = type === 'opt_out_share' ? now : dueAtForMarket(now, normalizedMarket);
    const row = await this.repository.insertRequest({
      userId,
      type,
      status: 'open',
      market: normalizedMarket,
      locale,
      payload: { note: note || null, openedBy: actorId || null },
      dueAt,
      identityStatus: 'unverified',
      channel: 'email',
      createdAt: now
    });
    this.logger.info({ requestId: row.id, userId, type }, 'Admin privacy request opened.');
    return this.getAdminRequest(row.id);
  }

  async setInProgress(id, actorId, actor) {
    const row = await this.requireAdminRequest(id, actor);
    if (isTerminalStatus(row.status)) {
      throw new HttpError(422, 'Request is already closed.', { code: 'already_closed' });
    }
    return this.repository.updateRequest(id, {
      status: 'in_progress',
      resolvedBy: actorId || null
    }).then((updated) => this.getAdminRequest(updated.id));
  }

  async extendOnce(id, reason, actorId, actor) {
    const row = await this.requireAdminRequest(id, actor);
    if (isTerminalStatus(row.status)) {
      throw new HttpError(422, 'Request is already closed.', { code: 'already_closed' });
    }
    if (row.extendedAt) {
      throw new HttpError(422, 'This request was already extended once.', { code: 'already_extended' });
    }
    const base = row.dueAt ? new Date(row.dueAt) : this.now();
    const dueAt = addCalendarDays(base, slaDaysForMarket(row.market));
    return this.repository.updateRequest(id, {
      dueAt,
      extendedAt: this.now(),
      extensionReason: reason,
      resolvedBy: actorId || null
    }).then((updated) => this.getAdminRequest(updated.id));
  }

  async completeRequest(id, note, actorId, actor) {
    const row = await this.requireAdminRequest(id, actor);
    if (isTerminalStatus(row.status)) {
      throw new HttpError(422, 'Request is already closed.', { code: 'already_closed' });
    }
    if (TYPES_REQUIRING_IDENTITY_TO_COMPLETE.includes(row.type) && !isIdentityVerified(row.identityStatus)) {
      throw new HttpError(422, 'Identity must be verified before completing this request.', {
        code: 'identity_unverified'
      });
    }

    if ((row.type === 'access' || row.type === 'portability') && row.userId) {
      const pack = await this.buildExportPackage(row.userId);
      await this.repository.updateRequest(id, {
        payload: { ...(row.payload || {}), package: pack }
      });
    }

    if (row.type === 'deletion' && row.userId) {
      try {
        await this.profileService.deleteAccount({ userId: row.userId });
      } catch (error) {
        if (error instanceof HttpError && error.details && error.details.code === 'active_subscription') {
          throw new HttpError(422, error.message, { code: 'active_subscription' });
        }
        throw error;
      }
    }

    return this.repository.updateRequest(id, {
      status: 'completed',
      resultNote: note || row.resultNote,
      resolvedAt: this.now(),
      resolvedBy: actorId || null
    }).then((updated) => this.getAdminRequest(updated.id));
  }

  async rejectRequest(id, note, actorId, actor) {
    const row = await this.requireAdminRequest(id, actor);
    if (isTerminalStatus(row.status)) {
      throw new HttpError(422, 'Request is already closed.', { code: 'already_closed' });
    }
    return this.repository.updateRequest(id, {
      status: 'rejected',
      resultNote: note || 'Rejected.',
      resolvedAt: this.now(),
      resolvedBy: actorId || null
    }).then((updated) => this.getAdminRequest(updated.id));
  }

  async sendIdentityVerification(id, actor) {
    const row = await this.requireAdminRequest(id, actor);
    if (!row.userId) {
      throw new HttpError(422, 'Link a user before sending verification.', { code: 'user_not_linked' });
    }
    const user = await this.profileRepository.findUserById(row.userId);
    if (!user || !user.email) {
      throw new HttpError(404, 'Account email was not found.', { code: 'user_not_found' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const identityTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await this.repository.updateRequest(id, {
      payload: {
        ...(row.payload || {}),
        identityTokenHash
      }
    });

    const confirmUrl = `${this.publicBaseUrl}/api/v1/privacy/identity-confirm?token=${encodeURIComponent(token)}`;
    if (this.mailer && typeof this.mailer.sendIdentityVerificationEmail === 'function') {
      await this.mailer.sendIdentityVerificationEmail({
        to: user.email,
        confirmUrl,
        locale: row.locale
      });
    }
    this.logger.info({ requestId: id, userId: row.userId }, 'Privacy identity verification emailed.');
    return { sent: true, to: user.email };
  }

  async markIdentityVerified(id, actorId, actor) {
    const row = await this.requireAdminRequest(id, actor);
    if (!row.userId) {
      throw new HttpError(422, 'Link a user before verifying identity.', { code: 'user_not_linked' });
    }
    return this.repository.updateRequest(id, {
      identityStatus: 'verified_account_email',
      identityVerifiedAt: this.now(),
      resolvedBy: actorId || null
    }).then((updated) => this.getAdminRequest(updated.id));
  }

  async confirmIdentityToken(token) {
    this.ensureRepository();
    const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
    const row = await this.repository.findRequestByIdentityTokenHash(hash);
    if (!row) {
      throw new HttpError(404, 'Verification link is invalid or expired.', { code: 'invalid_token' });
    }
    if (isIdentityVerified(row.identityStatus)) {
      return { verified: true, requestId: row.id };
    }
    await this.repository.updateRequest(row.id, {
      identityStatus: 'verified_account_email',
      identityVerifiedAt: this.now(),
      payload: {
        ...(row.payload || {}),
        identityTokenHash: null
      }
    });
    this.logger.info({ requestId: row.id, userId: row.userId }, 'Privacy identity confirmed.');
    return { verified: true, requestId: row.id };
  }

  async downloadAdminPackage(id, actor) {
    const row = await this.requireAdminRequest(id, actor);
    if (row.type !== 'access' && row.type !== 'portability') {
      throw new HttpError(422, 'This request has no export package.', { code: 'no_export_package' });
    }
    if (!isIdentityVerified(row.identityStatus)) {
      throw new HttpError(422, 'Identity must be verified before downloading the package.', {
        code: 'identity_unverified'
      });
    }
    if (row.payload && row.payload.package) {
      return row.payload.package;
    }
    if (!row.userId) {
      throw new HttpError(422, 'No account is linked to this request.', { code: 'user_not_linked' });
    }
    return this.buildExportPackage(row.userId);
  }

  async getUserPrivacySnapshot(userId, actor) {
    if (shouldEnforceMarketScope(actor) && this.profileRepository) {
      const user = await this.profileRepository.findUserById(userId);
      if (!user) {
        throw new HttpError(404, 'User not found.', { code: 'not_found' });
      }
      assertRecordMarket(actor, user.marketCountry);
    }
    const [marketing, cookies, consents, requests] = await Promise.all([
      this.getMarketing({ userId }).catch(() => ({ marketingOptIn: false })),
      this.getCookiePreferences({ userId }).catch(() => ({ analytics: null, ads: null })),
      this.listConsents({ userId }).catch(() => []),
      this.listOwnRequests({ userId }).catch(() => [])
    ]);
    return {
      marketingOptIn: marketing.marketingOptIn,
      cookiePreferences: cookies,
      consents: consents.slice(0, 20),
      requests
    };
  }

  async requireAdminRequest(id, actor) {
    this.ensureRepository();
    const row = await this.repository.findRequestById(id);
    if (!row) {
      throw new HttpError(404, 'Privacy request not found.', { code: 'not_found' });
    }
    if (shouldEnforceMarketScope(actor)) {
      assertRecordMarket(actor, row.market);
    }
    return row;
  }

  async anonymizeBillingArtifacts(userId) {
    if (this.customerStore && typeof this.customerStore.getCustomerId === 'function') {
      for (const account of [STRIPE_ACCOUNTS.BR, STRIPE_ACCOUNTS.US]) {
        try {
          const customerId = await this.customerStore.getCustomerId(userId, account);
          if (!customerId) {
            continue;
          }
          const billing = resolveStripeBilling({ stripeAccounts: this.stripeAccounts }, account);
          if (billing && typeof billing.anonymizeCustomer === 'function') {
            await billing.anonymizeCustomer(customerId);
          }
        } catch (_error) {
          // best-effort: missing Stripe config or already-deleted customer
        }
      }
    }

    if (this.quotesRepository && typeof this.quotesRepository.deleteByUserId === 'function') {
      await this.quotesRepository.deleteByUserId(userId);
    }

    if (this.repository && typeof this.repository.hardDeletePetsByUserId === 'function') {
      await this.repository.hardDeletePetsByUserId(userId);
    }
  }
}

module.exports = {
  PrivacyService,
  presentOwnRequest
};
