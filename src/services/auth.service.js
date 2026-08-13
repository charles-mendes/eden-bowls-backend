const { HttpError } = require('../core/http-error');
const crypto = require('crypto');
const { verifyWordpressPassword } = require('../core/wordpress-password');
const { issueJwtToken } = require('../core/jwt-token');
const { AUTH_ERROR } = require('../api/contracts/auth-errors');

const CRITICAL_OPERATION_BLOCKED_STATUSES = new Set(['pending', 'inactive', 'suspended', 'banned']);

class AuthService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.refreshTokenRepository = options.refreshTokenRepository || null;
    this.jwt = options.jwt || {};
    this.refreshTokenTtlSeconds = Number(options.refreshTokenTtlSeconds || 30 * 24 * 60 * 60);
    this.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => Math.floor(Date.now() / 1000);
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
