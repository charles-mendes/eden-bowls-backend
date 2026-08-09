const crypto = require('crypto');
const { HttpError } = require('./http-error');
const { AUTH_ERROR } = require('../api/contracts/auth-errors');

const SUPPORTED_ALGORITHMS = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512'
};

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function issueJwtToken(payload, options) {
  const secret = String(options.secret || '').trim();
  const algorithm = String(options.algorithm || 'HS256').trim().toUpperCase();
  const issuer = String(options.issuer || '').trim();
  const now = Number.isFinite(options.now) ? options.now : Math.floor(Date.now() / 1000);
  const ttlSeconds = Number.isFinite(options.ttlSeconds) ? options.ttlSeconds : 7 * 24 * 60 * 60;
  const nbf = Number.isFinite(options.notBefore) ? options.notBefore : now;
  const hashAlgorithm = SUPPORTED_ALGORITHMS[algorithm];

  if (!secret) {
    throw new HttpError(AUTH_ERROR.BAD_CONFIG.status, AUTH_ERROR.BAD_CONFIG.message, {
      code: AUTH_ERROR.BAD_CONFIG.code
    });
  }

  if (!hashAlgorithm) {
    throw new HttpError(AUTH_ERROR.UNSUPPORTED_ALGORITHM.status, AUTH_ERROR.UNSUPPORTED_ALGORITHM.message, {
      code: AUTH_ERROR.UNSUPPORTED_ALGORITHM.code
    });
  }

  const header = {
    typ: 'JWT',
    alg: algorithm
  };

  const claims = {
    iss: issuer,
    iat: now,
    nbf,
    exp: now + ttlSeconds,
    data: payload.data
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const content = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac(hashAlgorithm, secret).update(content).digest();

  return `${content}.${base64UrlEncode(signature)}`;
}

function verifyJwtToken(token, options) {
  const secret = String(options.secret || '').trim();
  const expectedAlgorithm = String(options.algorithm || 'HS256').trim().toUpperCase();
  const expectedIssuer = String(options.issuer || '').trim();
  const hashAlgorithm = SUPPORTED_ALGORITHMS[expectedAlgorithm];
  const now = Number.isFinite(options.now) ? options.now : Math.floor(Date.now() / 1000);

  if (!secret) {
    throw new HttpError(AUTH_ERROR.BAD_CONFIG.status, AUTH_ERROR.BAD_CONFIG.message, {
      code: AUTH_ERROR.BAD_CONFIG.code
    });
  }

  if (!hashAlgorithm) {
    throw new HttpError(AUTH_ERROR.UNSUPPORTED_ALGORITHM.status, AUTH_ERROR.UNSUPPORTED_ALGORITHM.message, {
      code: AUTH_ERROR.UNSUPPORTED_ALGORITHM.code
    });
  }

  const parts = String(token || '').split('.');

  if (parts.length !== 3) {
    throw new HttpError(AUTH_ERROR.INVALID_TOKEN.status, AUTH_ERROR.INVALID_TOKEN.message, {
      code: AUTH_ERROR.INVALID_TOKEN.code
    });
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header;
  let payload;

  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (error) {
    throw new HttpError(AUTH_ERROR.INVALID_TOKEN.status, AUTH_ERROR.INVALID_TOKEN.message, {
      code: AUTH_ERROR.INVALID_TOKEN.code
    });
  }

  if (!header || header.alg !== expectedAlgorithm) {
    throw new HttpError(AUTH_ERROR.INVALID_TOKEN.status, AUTH_ERROR.INVALID_TOKEN.message, {
      code: AUTH_ERROR.INVALID_TOKEN.code
    });
  }

  const content = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = base64UrlEncode(crypto.createHmac(hashAlgorithm, secret).update(content).digest());

  if (expectedSignature !== encodedSignature) {
    throw new HttpError(AUTH_ERROR.INVALID_TOKEN.status, AUTH_ERROR.INVALID_TOKEN.message, {
      code: AUTH_ERROR.INVALID_TOKEN.code
    });
  }

  if (expectedIssuer && payload.iss !== expectedIssuer) {
    throw new HttpError(AUTH_ERROR.INVALID_TOKEN.status, AUTH_ERROR.INVALID_TOKEN.message, {
      code: AUTH_ERROR.INVALID_TOKEN.code
    });
  }

  if (!payload.data || !payload.data.user || !payload.data.user.id) {
    throw new HttpError(AUTH_ERROR.INVALID_TOKEN.status, AUTH_ERROR.INVALID_TOKEN.message, {
      code: AUTH_ERROR.INVALID_TOKEN.code
    });
  }

  if (Number.isFinite(payload.nbf) && now < payload.nbf) {
    throw new HttpError(AUTH_ERROR.INVALID_TOKEN.status, AUTH_ERROR.INVALID_TOKEN.message, {
      code: AUTH_ERROR.INVALID_TOKEN.code
    });
  }

  if (Number.isFinite(payload.exp) && now >= payload.exp) {
    throw new HttpError(AUTH_ERROR.INVALID_TOKEN.status, AUTH_ERROR.INVALID_TOKEN.message, {
      code: AUTH_ERROR.INVALID_TOKEN.code
    });
  }

  return payload;
}

module.exports = {
  issueJwtToken,
  verifyJwtToken,
  SUPPORTED_ALGORITHMS
};
