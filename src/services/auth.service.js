const { HttpError } = require('../core/http-error');
const crypto = require('crypto');
const { hashWordpressPassword, verifyWordpressPassword } = require('../core/wordpress-password');
const { generateOtp, hashOtp, otpMatches } = require('../core/otp');
const { issueJwtToken } = require('../core/jwt-token');
const { AUTH_ERROR } = require('../api/contracts/auth-errors');

const CRITICAL_OPERATION_BLOCKED_STATUSES = new Set(['pending', 'inactive', 'suspended', 'banned']);

class AuthService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.refreshTokenRepository = options.refreshTokenRepository || null;
    this.jwt = options.jwt || {};
    this.refreshTokenTtlSeconds = Number(options.refreshTokenTtlSeconds || 30 * 24 * 60 * 60);
    this.otpTtlSeconds = Number(options.otpTtlSeconds || 600);
    this.otpMaxAttempts = Number(options.otpMaxAttempts || 5);
    this.otpMailer = options.otpMailer || null;
    this.hashPassword = typeof options.hashPassword === 'function' ? options.hashPassword : hashWordpressPassword;
    this.randomOtp = typeof options.randomOtp === 'function' ? options.randomOtp : generateOtp;
    this.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => Math.floor(Date.now() / 1000);
  }

  async checkEmailExists(email) {
    if (!this.repository) {
      throw new HttpError(503, 'Auth repository is not available.');
    }

    const exists = await this.repository.emailExists(email);

    return {
      email,
      exists: Boolean(exists)
    };
  }

  async register(payload) {
    if (!this.repository) {
      throw new HttpError(503, 'Auth repository is not available.');
    }

    const exists = await this.repository.emailExists(payload.email);
    if (exists) {
      throw new HttpError(AUTH_ERROR.EMAIL_EXISTS.status, AUTH_ERROR.EMAIL_EXISTS.message, {
        code: AUTH_ERROR.EMAIL_EXISTS.code,
        field: 'email'
      });
    }

    const issuedAt = this.nowProvider();
    const otp = this.randomOtp();
    const otpExpiresAt = issuedAt + this.otpTtlSeconds;
    const user = await this.repository.createPendingUser({
      userLogin: payload.username,
      userPass: this.hashPassword(payload.password),
      userNicename: this.toNicename(payload.username),
      userEmail: payload.email,
      displayName: payload.username,
      otpHash: this.hashOtpValue(otp),
      otpExpiresAt
    });

    try {
      await this.sendOtpEmail({
        to: user.user_email,
        otp,
        expiresInSeconds: this.otpTtlSeconds
      });
    } catch (error) {
      throw new HttpError(AUTH_ERROR.OTP_EMAIL_FAILED.status, AUTH_ERROR.OTP_EMAIL_FAILED.message, {
        code: AUTH_ERROR.OTP_EMAIL_FAILED.code,
        uid: user.id
      });
    }

    return {
      uid: user.id,
      email: user.user_email,
      otp_expires_in: this.otpTtlSeconds
    };
  }

  async verifyOtp(payload) {
    if (!this.repository) {
      throw new HttpError(503, 'Auth repository is not available.');
    }

    if (!payload.termsAccepted || !payload.privacyAccepted) {
      throw new HttpError(AUTH_ERROR.TERMS_NOT_ACCEPTED.status, AUTH_ERROR.TERMS_NOT_ACCEPTED.message, {
        code: AUTH_ERROR.TERMS_NOT_ACCEPTED.code
      });
    }

    const user = await this.repository.findUserForOtp(payload.uid);
    if (!user) {
      throw new HttpError(AUTH_ERROR.USER_NOT_FOUND.status, AUTH_ERROR.USER_NOT_FOUND.message, {
        code: AUTH_ERROR.USER_NOT_FOUND.code
      });
    }

    if (user.activation_status === 'active') {
      throw new HttpError(AUTH_ERROR.ACCOUNT_ALREADY_ACTIVE.status, AUTH_ERROR.ACCOUNT_ALREADY_ACTIVE.message, {
        code: AUTH_ERROR.ACCOUNT_ALREADY_ACTIVE.code
      });
    }

    if (user.otp_attempts >= this.otpMaxAttempts) {
      throw new HttpError(AUTH_ERROR.OTP_ATTEMPTS_EXCEEDED.status, AUTH_ERROR.OTP_ATTEMPTS_EXCEEDED.message, {
        code: AUTH_ERROR.OTP_ATTEMPTS_EXCEEDED.code
      });
    }

    const now = this.nowProvider();
    if (!user.otp_hash || !user.otp_expires_at || now >= user.otp_expires_at) {
      throw new HttpError(AUTH_ERROR.OTP_EXPIRED.status, AUTH_ERROR.OTP_EXPIRED.message, {
        code: AUTH_ERROR.OTP_EXPIRED.code
      });
    }

    if (!otpMatches(payload.otp, user.otp_hash, this.otpSecret())) {
      await this.repository.saveOtpAttempts(user.id, user.otp_attempts + 1);
      throw new HttpError(AUTH_ERROR.OTP_INVALID.status, AUTH_ERROR.OTP_INVALID.message, {
        code: AUTH_ERROR.OTP_INVALID.code
      });
    }

    await this.repository.activateUser(user.id, {
      marketingOptIn: Boolean(payload.marketingOptIn),
      termsAccepted: true,
      privacyAccepted: true
    });

    return {
      token_endpoint: '/api/v1/auth/token'
    };
  }

  async resendOtp(payload) {
    if (!this.repository) {
      throw new HttpError(503, 'Auth repository is not available.');
    }

    const user = await this.repository.findUserForOtp(payload.uid);
    if (!user) {
      throw new HttpError(AUTH_ERROR.USER_NOT_FOUND.status, AUTH_ERROR.USER_NOT_FOUND.message, {
        code: AUTH_ERROR.USER_NOT_FOUND.code
      });
    }

    if (user.activation_status === 'active') {
      throw new HttpError(AUTH_ERROR.ACCOUNT_ALREADY_ACTIVE.status, AUTH_ERROR.ACCOUNT_ALREADY_ACTIVE.message, {
        code: AUTH_ERROR.ACCOUNT_ALREADY_ACTIVE.code
      });
    }

    const issuedAt = this.nowProvider();
    const otp = this.randomOtp();
    const otpExpiresAt = issuedAt + this.otpTtlSeconds;

    await this.repository.saveOtpChallenge(user.id, {
      otpHash: this.hashOtpValue(otp),
      otpExpiresAt,
      attempts: 0
    });

    try {
      await this.sendOtpEmail({
        to: user.user_email,
        otp,
        expiresInSeconds: this.otpTtlSeconds
      });
    } catch (error) {
      throw new HttpError(AUTH_ERROR.OTP_EMAIL_FAILED.status, AUTH_ERROR.OTP_EMAIL_FAILED.message, {
        code: AUTH_ERROR.OTP_EMAIL_FAILED.code,
        uid: user.id
      });
    }

    return {
      uid: user.id,
      otp_expires_in: this.otpTtlSeconds
    };
  }

  async sendOtpEmail(payload) {
    if (!this.otpMailer || typeof this.otpMailer.sendOtpEmail !== 'function') {
      throw new Error('OTP mailer is not configured.');
    }

    await this.otpMailer.sendOtpEmail(payload);
  }

  hashOtpValue(otp) {
    return hashOtp(otp, this.otpSecret());
  }

  otpSecret() {
    return String(this.jwt.secret || 'otp');
  }

  toNicename(username) {
    const slug = String(username || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    return slug || 'user';
  }

  async authenticate(credentials) {
    if (!this.repository) {
      throw new HttpError(503, 'Auth repository is not available.');
    }

    const user = await this.repository.findUserForAuthentication(credentials.username);

    if (!user || !verifyWordpressPassword(credentials.password, user.user_pass)) {
      throw new HttpError(AUTH_ERROR.INVALID_CREDENTIALS.status, AUTH_ERROR.INVALID_CREDENTIALS.message, {
        code: AUTH_ERROR.INVALID_CREDENTIALS.code
      });
    }

    if (user.activation_status === 'pending') {
      throw new HttpError(AUTH_ERROR.ACCOUNT_PENDING.status, AUTH_ERROR.ACCOUNT_PENDING.message, {
        code: AUTH_ERROR.ACCOUNT_PENDING.code
      });
    }

    const issuedAt = this.nowProvider();
    const token = this.issueAccessToken(user, issuedAt);
    const refreshToken = await this.issueRefreshToken(user.id, issuedAt);

    return {
      token,
      user_email: user.user_email,
      user_nicename: user.user_nicename,
      user_display_name: user.display_name,
      refreshToken
    };
  }

  async getCurrentUser(userId) {
    if (!this.repository) {
      throw new HttpError(503, 'Auth repository is not available.');
    }

    const user = await this.repository.findUserById(userId);
    if (!user || user.activation_status === 'pending') {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    return {
      user_email: user.user_email,
      user_nicename: user.user_nicename,
      user_display_name: user.display_name
    };
  }

  async assertCriticalOperationAllowed(userId) {
    if (!this.repository) {
      throw new HttpError(503, 'Auth repository is not available.');
    }

    const user = await this.repository.findUserById(userId);
    const status = String(user && user.activation_status || '').trim().toLowerCase();
    if (!user || CRITICAL_OPERATION_BLOCKED_STATUSES.has(status)) {
      throw new HttpError(403, 'Account is not allowed to perform this operation.', {
        code: 'account_operation_not_allowed'
      });
    }

    return user;
  }

  async refresh(rawRefreshToken) {
    if (!this.refreshTokenRepository) {
      throw new HttpError(503, 'Refresh token repository is not available.');
    }

    const normalizedToken = String(rawRefreshToken || '').trim();
    if (!normalizedToken) {
      throw new HttpError(401, 'Authentication is required.', { code: 'refresh_token_invalid' });
    }

    const issuedAt = this.nowProvider();
    const now = this.toSqlDate(issuedAt);
    const rawSuccessor = crypto.randomBytes(64).toString('base64url');
    const successor = {
      id: crypto.randomUUID(),
      tokenHash: this.hashRefreshToken(rawSuccessor),
      expiresAt: this.toSqlDate(issuedAt + this.refreshTokenTtlSeconds)
    };
    const rotated = await this.refreshTokenRepository.rotateAtomically({
      tokenHash: this.hashRefreshToken(normalizedToken),
      successor,
      now,
      replayGraceUntil: this.toSqlDate(issuedAt + 5)
    });

    if (rotated.status === 'reuse') {
      await this.refreshTokenRepository.revokeFamily(rotated.source.familyId, 'reuse_detected', now);
      throw new HttpError(401, 'Authentication is required.', { code: 'refresh_token_reused' });
    }

    if (rotated.status === 'missing' || rotated.status === 'invalid') {
      throw new HttpError(401, 'Authentication is required.', { code: 'refresh_token_invalid' });
    }

    const user = await this.repository.findUserById(rotated.source.userId);
    if (!user || user.activation_status === 'pending') {
      await this.refreshTokenRepository.revokeFamily(rotated.source.familyId, 'user_inactive', now);
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    return {
      token: this.issueAccessToken(user, issuedAt),
      user_email: user.user_email,
      user_nicename: user.user_nicename,
      user_display_name: user.display_name,
      refreshToken: rotated.status === 'rotated' ? rawSuccessor : null
    };
  }

  async logout(rawRefreshToken) {
    if (!this.refreshTokenRepository) {
      return;
    }

    const normalizedToken = String(rawRefreshToken || '').trim();
    if (!normalizedToken) {
      return;
    }

    const record = await this.refreshTokenRepository.findByHash(this.hashRefreshToken(normalizedToken));
    if (record) {
      await this.refreshTokenRepository.revokeFamily(record.familyId, 'logout', this.toSqlDate(this.nowProvider()));
    }
  }

  issueAccessToken(user, issuedAt) {
    return issueJwtToken(
      {
        data: {
          user: {
            id: user.id
          }
        }
      },
      {
        secret: this.jwt.secret,
        algorithm: this.jwt.algorithm,
        issuer: this.jwt.issuer,
        ttlSeconds: this.jwt.expiresInSeconds,
        notBefore: issuedAt,
        now: issuedAt
      }
    );
  }

  async issueRefreshToken(userId, issuedAt) {
    if (!this.refreshTokenRepository) {
      return null;
    }

    const rawToken = crypto.randomBytes(64).toString('base64url');
    const tokenHash = this.hashRefreshToken(rawToken);

    await this.refreshTokenRepository.create({
      id: crypto.randomUUID(),
      userId,
      familyId: crypto.randomUUID(),
      tokenHash,
      expiresAt: this.toSqlDate(issuedAt + this.refreshTokenTtlSeconds)
    });

    return rawToken;
  }

  hashRefreshToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  toSqlDate(seconds) {
    return new Date(seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }
}

module.exports = {
  AuthService,
  CRITICAL_OPERATION_BLOCKED_STATUSES
};
