const { issueJwtToken, verifyJwtToken } = require('../src/core/jwt-token');

describe('jwt token helpers', () => {
  test('verifies a valid token', () => {
    const token = issueJwtToken(
      {
        data: {
          user: {
            id: 1
          }
        }
      },
      {
        secret: 'test-secret',
        algorithm: 'HS256',
        issuer: 'http://localhost:3000',
        now: 1700000000,
        ttlSeconds: 3600
      }
    );

    const payload = verifyJwtToken(token, {
      secret: 'test-secret',
      algorithm: 'HS256',
      issuer: 'http://localhost:3000',
      now: 1700000001
    });

    expect(payload.data.user.id).toBe(1);
  });

  test('rejects invalid signature', () => {
    const token = issueJwtToken(
      {
        data: {
          user: {
            id: 1
          }
        }
      },
      {
        secret: 'test-secret',
        algorithm: 'HS256',
        issuer: 'http://localhost:3000',
        now: 1700000000,
        ttlSeconds: 3600
      }
    );

    expect(() => verifyJwtToken(token, {
      secret: 'wrong-secret',
      algorithm: 'HS256',
      issuer: 'http://localhost:3000',
      now: 1700000001
    })).toThrow('JWT token is invalid.');
  });
});
