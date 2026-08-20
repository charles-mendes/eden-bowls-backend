const { HttpError } = require('../core/http-error');
const { hashWordpressPassword, verifyWordpressPassword } = require('../core/wordpress-password');
const { normalizeCountry, normalizeZipcode } = require('./onboarding-zipcode.service');
const { formatStateForDisplay, formatStateForStorage } = require('../core/us-states');

const ALLOWED_COUNTRIES = ['BR', 'US'];
const AVATAR_MIME_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVE_SUBSCRIPTION_DELETE_MESSAGE = 'You have an active subscription. Please cancel it before deleting your account.';
const CANCELED_LEDGER_STATUSES = new Set(['canceled', 'cancelled']);

function emptyDelivery() {
  return {
    address: '',
    complement: '',
    city: '',
    state: '',
    zipCode: '',
    deliveryInstructions: ''
  };
}

function presentAvatarUrl(value) {
  const url = String(value || '').trim();
  return url || null;
}

function presentPasswordTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)) {
    return text.slice(0, 19).replace('T', ' ');
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function toSqlDateTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function isBlankPassword(value) {
  return typeof value !== 'string' || value === '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return EMAIL_PATTERN.test(value) && value.length <= 100;
}

function matchesMagicBytes(buffer, mimeType) {
  if (!buffer || buffer.length < 4) {
    return false;
  }

  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }

  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }

  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP';
  }

  return false;
}

function decodeImageBase64(imageBase64) {
  const raw = String(imageBase64 || '');
  if (!raw || /data:|,/.test(raw)) {
    throw new HttpError(422, 'Invalid image data.', { code: 'invalid_image' });
  }

  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) {
    throw new HttpError(422, 'Invalid image data.', { code: 'invalid_image' });
  }

  return buffer;
}

function resolvePhoneCountry(user, address = {}) {
  const candidates = [
    user && user.phoneCountry,
    address.phone_country,
    address.country,
    user && user.marketCountry
  ];

  for (const candidate of candidates) {
    const country = normalizeCountry(candidate);
    if (country) {
      return { countryCode: country, locked: true };
    }
  }

  return { countryCode: 'US', locked: false };
}

function resolveAddressCountry(user, address = {}) {
  const fromAddress = normalizeCountry(address.country);
  if (fromAddress) {
    return fromAddress;
  }

  return resolvePhoneCountry(user, address).countryCode;
}

function availableCountryCodes(phoneCountry) {
  return phoneCountry.locked ? [phoneCountry.countryCode] : [...ALLOWED_COUNTRIES];
}

function coerceCountryCode(requested, available) {
  const normalized = normalizeCountry(requested);
  if (normalized && available.includes(normalized)) {
    return normalized;
  }

  return available[0] || 'US';
}

function mapDelivery(address, country) {
  if (!address || typeof address !== 'object') {
    return emptyDelivery();
  }

  return {
    address: String(address.street || address.address_line1 || ''),
    complement: String(address.complement || address.address_line2 || ''),
    city: String(address.city || ''),
    state: formatStateForDisplay(address.state, country),
    zipCode: String(address.zipcode || address.postal_code || ''),
    deliveryInstructions: String(address.delivery_instructions || '')
  };
}

function buildAccountStatus(hasActive) {
  const hasActiveSubscription = hasActive === true || hasActive === null;

  return {
    hasActiveSubscription,
    canDeleteAccount: !hasActiveSubscription,
    deleteRestrictionMessage: hasActiveSubscription ? ACTIVE_SUBSCRIPTION_DELETE_MESSAGE : null
  };
}

class ProfileService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.authService = options.authService || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.refreshTokenRepository = options.refreshTokenRepository || null;
    this.stripeBilling = options.stripeBilling || null;
    this.avatarStorage = options.avatarStorage || null;
    this.hashPassword = typeof options.hashPassword === 'function' ? options.hashPassword : hashWordpressPassword;
    this.verifyPassword = typeof options.verifyPassword === 'function' ? options.verifyPassword : verifyWordpressPassword;
    this.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => new Date();
  }

  ensureRepository() {
    if (!this.repository) {
      throw new HttpError(503, 'Profile repository is not available.');
    }
  }

  async assertMutationAllowed(userId) {
    if (!this.authService || typeof this.authService.assertCriticalOperationAllowed !== 'function') {
      throw new HttpError(503, 'Auth service is not available for critical operations.');
    }

    return this.authService.assertCriticalOperationAllowed(userId);
  }

  async loadUser(userId) {
    this.ensureRepository();
    const user = await this.repository.findUserById(userId);
    if (!user) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    return user;
  }

  async getProfile({ userId }) {
    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const user = await this.loadUser(userId);
    if (user.activationStatus === 'pending') {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const addressRecord = await this.repository.getAddress(user.id);
    const address = addressRecord.exists ? addressRecord.address : {};
    const phoneCountry = resolvePhoneCountry(user, address);
    const deliveryCountry = resolveAddressCountry(user, address);
    const hasActive = this.ledgerRepository
      ? await this.ledgerRepository.hasActiveSubscription(user.id, user.email)
      : null;

    return {
      id: user.id,
      fullName: user.displayName || user.userLogin,
      email: user.email,
      phone: user.phone || '',
      countryCode: phoneCountry.countryCode,
      availableCountryCodes: availableCountryCodes(phoneCountry),
      avatarUrl: presentAvatarUrl(user.avatarUrl),
      passwordLastUpdatedAt: presentPasswordTimestamp(user.passwordLastUpdatedAt),
      delivery: addressRecord.exists ? mapDelivery(address, deliveryCountry) : emptyDelivery(),
      accountStatus: buildAccountStatus(hasActive)
    };
  }

  async updatePersonal({ userId, payload = {} }) {
    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    await this.assertMutationAllowed(userId);
    const user = await this.loadUser(userId);
    const fullName = String(payload.fullName || '').trim();
    if (!fullName) {
      throw new HttpError(422, 'Full name is required.', {
        code: 'validation_error',
        field: 'fullName'
      });
    }

    const addressRecord = await this.repository.getAddress(user.id);
    const address = addressRecord.exists ? addressRecord.address : {};
    const phoneCountry = resolvePhoneCountry(user, address);
    const available = availableCountryCodes(phoneCountry);
    const countryCode = coerceCountryCode(payload.countryCode, available);
    const phone = payload.phone == null ? '' : String(payload.phone);

    await this.repository.updateDisplayName(user.id, fullName);
    await this.repository.upsertUserMeta(user.id, 'billing_phone', phone);
    await this.repository.upsertUserMeta(user.id, '_eden_phone_country', countryCode);

    if (payload.avatarUrl === null) {
      await this.repository.upsertUserMeta(user.id, '_eden_avatar_url', '');
    } else if (typeof payload.avatarUrl === 'string' && payload.avatarUrl) {
      await this.repository.upsertUserMeta(user.id, '_eden_avatar_url', payload.avatarUrl);
    }

    if (addressRecord.exists) {
      await this.repository.mergeAddress(user.id, {
        phone,
        phone_country: countryCode
      });
    }

    const avatarUrl = payload.avatarUrl === null
      ? null
      : presentAvatarUrl(
        typeof payload.avatarUrl === 'string' && payload.avatarUrl
          ? payload.avatarUrl
          : await this.repository.getUserMeta(user.id, '_eden_avatar_url')
      );

    return {
      fullName,
      phone,
      countryCode,
      availableCountryCodes: [countryCode],
      avatarUrl
    };
  }

  async updateDelivery({ userId, payload = {}, skipAccountCheck = false }) {
    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    if (!skipAccountCheck) {
      await this.assertMutationAllowed(userId);
    }
    const user = await this.loadUser(userId);
    const addressRecord = await this.repository.getAddress(user.id);
    const currentAddress = addressRecord.exists ? addressRecord.address : {};
    const country = resolveAddressCountry(user, currentAddress);

    const street = String(payload.address || '').trim();
    const complement = String(payload.complement || '').trim();
    const city = String(payload.city || '').trim();
    const stateForStorage = formatStateForStorage(payload.state, country);
    const zipCode = normalizeZipcode(country, payload.zipCode);

    const errors = {};
    if (!street) {
      errors.address = 'This field is required.';
    }
    if (!city) {
      errors.city = 'This field is required.';
    }
    if (!stateForStorage) {
      errors.state = 'This field is required.';
    }
    if (!String(payload.zipCode || '').trim()) {
      errors.zipCode = 'This field is required.';
    }

    if (Object.keys(errors).length > 0) {
      throw new HttpError(422, 'Required fields are missing.', {
        code: 'validation_error',
        errors
      });
    }

    if (country === 'BR' && !/^\d{8}$/.test(zipCode)) {
      throw new HttpError(422, 'Invalid zipcode.', { code: 'invalid_zipcode', field: 'zipCode' });
    }

    if (country === 'US' && !/^(\d{5})(-\d{4})?$/.test(zipCode)) {
      throw new HttpError(422, 'Invalid zipcode.', { code: 'invalid_zipcode', field: 'zipCode' });
    }

    const patch = {
      street,
      address_line1: street,
      complement,
      address_line2: complement,
      city,
      state: stateForStorage,
      zipcode: zipCode,
      postal_code: zipCode,
      delivery_instructions: String(payload.deliveryInstructions || '').trim()
    };

    if (!addressRecord.exists) {
      patch.country = country;
    }

    const saved = await this.repository.mergeAddress(user.id, patch, { createIfMissing: true });
    return mapDelivery(saved, country);
  }

  async changeEmail({ userId, payload = {} }) {
    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    await this.assertMutationAllowed(userId);

    if (isBlankPassword(payload.currentPassword)) {
      throw new HttpError(422, 'Current password is required.', {
        code: 'validation_error',
        field: 'currentPassword'
      });
    }

    const user = await this.loadUser(userId);
    if (!this.verifyPassword(payload.currentPassword, user.userPass)) {
      throw new HttpError(422, 'Current password is incorrect.', {
        code: 'invalid_password',
        field: 'currentPassword'
      });
    }

    const email = normalizeEmail(payload.newEmail);
    if (!isValidEmail(email)) {
      throw new HttpError(422, 'A valid email address is required.', {
        code: 'validation_error',
        field: 'newEmail'
      });
    }

    const ownerId = await this.repository.findUserIdByEmail(email);
    if (ownerId && ownerId !== user.id) {
      throw new HttpError(422, 'This email address is already in use.', {
        code: 'email_taken',
        field: 'newEmail'
      });
    }

    if (ownerId !== user.id) {
      await this.repository.updateUserEmail(user.id, email);
    }

    return { email };
  }

  async changePassword({ userId, payload = {} }) {
    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    await this.assertMutationAllowed(userId);

    if (isBlankPassword(payload.currentPassword)) {
      throw new HttpError(422, 'Current password is required.', {
        code: 'validation_error',
        field: 'currentPassword'
      });
    }

    const user = await this.loadUser(userId);
    if (!this.verifyPassword(payload.currentPassword, user.userPass)) {
      throw new HttpError(422, 'Current password is incorrect.', {
        code: 'invalid_password',
        field: 'currentPassword'
      });
    }

    const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
    if (newPassword.length < 8) {
      throw new HttpError(422, 'New password must be at least 8 characters.', {
        code: 'validation_error',
        field: 'newPassword'
      });
    }

    const confirmPassword = typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';
    if (newPassword !== confirmPassword) {
      throw new HttpError(422, 'New passwords do not match.', {
        code: 'password_mismatch',
        field: 'confirmPassword'
      });
    }

    await this.repository.updateUserPassword(user.id, this.hashPassword(newPassword));
    const passwordLastUpdatedAt = toSqlDateTime(this.nowProvider());
    await this.repository.upsertUserMeta(user.id, '_eden_pwd_updated_at', passwordLastUpdatedAt);

    if (this.refreshTokenRepository && typeof this.refreshTokenRepository.revokeAllForUser === 'function') {
      await this.refreshTokenRepository.revokeAllForUser(user.id, 'password_changed', passwordLastUpdatedAt);
    }

    return { passwordLastUpdatedAt };
  }

  async uploadAvatar({ userId, payload = {} }) {
    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    await this.assertMutationAllowed(userId);
    const user = await this.loadUser(userId);

    if (!this.avatarStorage || typeof this.avatarStorage.write !== 'function') {
      throw new HttpError(503, 'Avatar storage is not available.');
    }

    const mimeType = String(payload.mimeType || 'image/jpeg').trim().toLowerCase();
    const ext = AVATAR_MIME_TYPES[mimeType];
    if (!ext) {
      throw new HttpError(422, 'Unsupported image type. Use PNG, JPEG, or WebP.', {
        code: 'invalid_mime'
      });
    }

    const buffer = decodeImageBase64(payload.imageBase64);
    if (buffer.length > MAX_AVATAR_BYTES) {
      throw new HttpError(422, 'Image must be smaller than 3 MB.', { code: 'image_too_large' });
    }

    if (!matchesMagicBytes(buffer, mimeType)) {
      throw new HttpError(422, 'Invalid image data.', { code: 'invalid_image' });
    }

    let avatarUrl;
    try {
      avatarUrl = await this.avatarStorage.write({ userId: user.id, ext, buffer });
    } catch (_error) {
      throw new HttpError(500, 'Failed to save avatar image.', { code: 'upload_failed' });
    }

    const previousUrl = presentAvatarUrl(user.avatarUrl);
    if (previousUrl && typeof this.avatarStorage.delete === 'function') {
      try {
        await this.avatarStorage.delete(previousUrl);
      } catch (_error) {
        // best-effort cleanup
      }
    }

    try {
      await this.repository.upsertUserMeta(user.id, '_eden_avatar_url', avatarUrl);
    } catch (_error) {
      if (typeof this.avatarStorage.delete === 'function') {
        try {
          await this.avatarStorage.delete(avatarUrl);
        } catch (_cleanupError) {
          // ignore
        }
      }
      throw new HttpError(500, 'Failed to save avatar image.', { code: 'upload_failed' });
    }

    return { avatarUrl };
  }

  async deleteAccount({ userId }) {
    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const user = await this.repository.findUserById(userId);
    if (!user) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    await this.assertMutationAllowed(userId);

    const hasActive = this.ledgerRepository
      ? await this.ledgerRepository.hasActiveSubscription(user.id, user.email)
      : null;
    const accountStatus = buildAccountStatus(hasActive);
    if (!accountStatus.canDeleteAccount) {
      throw new HttpError(422, ACTIVE_SUBSCRIPTION_DELETE_MESSAGE, { code: 'active_subscription' });
    }

    await this.cancelLeftoverSubscriptions(user.id);
    const now = toSqlDateTime(this.nowProvider());

    if (this.refreshTokenRepository && typeof this.refreshTokenRepository.revokeAllForUser === 'function') {
      await this.refreshTokenRepository.revokeAllForUser(user.id, 'account_deleted', now);
    }

    await this.repository.softDeletePetsByUserId(user.id, now);
    await this.repository.deleteUserState(user.id);

    if (presentAvatarUrl(user.avatarUrl) && this.avatarStorage && typeof this.avatarStorage.delete === 'function') {
      try {
        await this.avatarStorage.delete(user.avatarUrl);
      } catch (_error) {
        // best-effort
      }
    }

    await this.repository.deleteUserAndMeta(user.id);

    return { deleted: true };
  }

  async cancelLeftoverSubscriptions(userId) {
    if (!this.ledgerRepository || typeof this.ledgerRepository.listByUserId !== 'function') {
      return;
    }

    const rows = await this.ledgerRepository.listByUserId(userId);
    const leftovers = (Array.isArray(rows) ? rows : []).filter((row) => {
      const status = String(row && row.status || '').toLowerCase();
      const subscriptionId = String(row && row.stripeSubscriptionId || '');
      return subscriptionId.startsWith('sub_') && !CANCELED_LEDGER_STATUSES.has(status);
    });

    if (leftovers.length === 0) {
      return;
    }

    if (!this.stripeBilling || typeof this.stripeBilling.cancelSubscriptionImmediately !== 'function') {
      throw new HttpError(502, 'Unable to cancel leftover Stripe subscriptions.', {
        code: 'stripe_subscription_cancel_failed'
      });
    }

    for (const leftover of leftovers) {
      await this.stripeBilling.cancelSubscriptionImmediately(leftover.stripeSubscriptionId);
    }
  }
}

module.exports = {
  ProfileService,
  ACTIVE_SUBSCRIPTION_DELETE_MESSAGE,
  resolvePhoneCountry,
  availableCountryCodes
};
