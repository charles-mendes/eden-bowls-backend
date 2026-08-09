const { HttpError } = require('../core/http-error');
const { verifyWordpressPassword } = require('../core/wordpress-password');
const { issueJwtToken } = require('../core/jwt-token');
const { AUTH_ERROR } = require('../api/contracts/auth-errors');

class AuthService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.jwt = options.jwt || {};
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
    const token = issueJwtToken(
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

    return {
      token,
      user_email: user.user_email,
      user_nicename: user.user_nicename,
      user_display_name: user.display_name
    };
  }
}

module.exports = {
  AuthService
};
