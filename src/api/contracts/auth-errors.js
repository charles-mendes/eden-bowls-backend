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
  }
};

module.exports = {
  AUTH_ERROR
};
