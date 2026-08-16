const AUTH_ERROR = {
  BAD_CONFIG: {
    status: 403,
    code: 'jwt_auth_bad_config',
    message: 'JWT is not configured properly.'
  },
  INVALID_CREDENTIALS: {
    status: 403,
    code: 'wp_authentication_failed',
    message: 'Invalid username or password.'
  },
  ACCOUNT_PENDING: {
    status: 403,
    code: 'account_pending_activation',
    message: 'Account pending activation.'
  },
  BAD_AUTH_HEADER: {
    status: 403,
    code: 'jwt_auth_bad_auth_header',
    message: 'Authorization header malformed.'
  },
  INVALID_TOKEN: {
    status: 403,
    code: 'jwt_auth_invalid_token',
    message: 'JWT token is invalid.'
  },
  UNSUPPORTED_ALGORITHM: {
    status: 403,
    code: 'jwt_auth_unsupported_algorithm',
    message: 'JWT algorithm is not supported.'
  },
  EMAIL_EXISTS: {
    status: 409,
    code: 'account_email_exists',
    message: 'This e-mail is already registered.'
  },
  USERNAME_EXISTS: {
    status: 409,
    code: 'account_username_exists',
    message: 'This username is already registered.'
  },
  OTP_EMAIL_FAILED: {
    status: 503,
    code: 'otp_email_failed',
    message: 'Unable to send the verification code right now.'
  },
  OTP_INVALID: {
    status: 403,
    code: 'otp_invalid',
    message: 'Invalid verification code.'
  },
  OTP_EXPIRED: {
    status: 403,
    code: 'otp_expired',
    message: 'This verification code has expired.'
  },
  OTP_ATTEMPTS_EXCEEDED: {
    status: 403,
    code: 'otp_attempts_exceeded',
    message: 'Too many incorrect verification attempts.'
  },
  ACCOUNT_ALREADY_ACTIVE: {
    status: 409,
    code: 'account_already_active',
    message: 'This account is already active.'
  },
  USER_NOT_FOUND: {
    status: 404,
    code: 'user_not_found',
    message: 'Account was not found.'
  },
  TERMS_NOT_ACCEPTED: {
    status: 403,
    code: 'terms_not_accepted',
    message: 'You must accept the terms of use and privacy policy to continue.'
  }
};

module.exports = {
  AUTH_ERROR
};
