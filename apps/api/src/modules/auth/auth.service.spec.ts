import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';

import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(),
    verify: jest.fn(),
  },
}));

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  role: {
    findUnique: jest.Mock;
  };
  userRole: {
    create: jest.Mock;
  };
  refreshToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
};

type JwtMock = {
  signAsync: jest.Mock;
  verifyAsync: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  role: {
    findUnique: jest.fn(),
  },
  userRole: {
    create: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
});

const makeJwtMock = (): JwtMock => ({
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
});

describe('AuthService', () => {
  let prisma: PrismaMock;
  let jwt: JwtMock;
  let service: AuthService;

  beforeEach(() => {
    prisma = makePrismaMock();
    jwt = makeJwtMock();
    service = new AuthService(prisma as never, jwt as unknown as JwtService);
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '30d';
    jest.mocked(argon2.hash).mockReset();
    jest.mocked(argon2.verify).mockReset();
  });

  it('register should create a user, attach customer role and issue tokens', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'john@example.com',
        status: 'active',
        userRoles: [
          {
            role: {
              code: 'customer',
              rolePermissions: [],
            },
          },
        ],
      });
    prisma.user.create.mockResolvedValue({ id: 'user_1' });
    prisma.role.findUnique.mockResolvedValue({ id: 'role_customer' });
    prisma.refreshToken.create.mockResolvedValue({ id: 'token_1' });
    jwt.signAsync
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');
    jest.mocked(argon2.hash).mockResolvedValue('refresh-token-hash' as never);

    const output = await service.register({ email: 'John@Example.com', password: 'secret123' });

    expect(output.accessToken).toBe('access-token');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'john@example.com',
          status: 'active',
        }),
      }),
    );
    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'user_1', roleId: 'role_customer' },
    });
  });

  it('register should reject already registered emails', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1' });

    await expect(service.register({ email: 'john@example.com', password: 'secret123' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('login should reject invalid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login({ email: 'john@example.com', password: 'secret123' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('login should update last login and issue tokens', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'john@example.com',
        status: 'active',
        passwordHash: 'hashed-password',
      })
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'john@example.com',
        status: 'active',
        userRoles: [
          {
            role: {
              code: 'customer',
              rolePermissions: [{ permission: { code: 'read' } }],
            },
          },
        ],
      });
    jest.mocked(argon2.verify).mockResolvedValue(true as never);
    prisma.user.update.mockResolvedValue({ id: 'user_1' });
    prisma.refreshToken.create.mockResolvedValue({ id: 'token_1' });
    jwt.signAsync
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');
    jest.mocked(argon2.hash).mockResolvedValue('refresh-token-hash' as never);

    const output = await service.login({ email: 'john@example.com', password: 'secret123' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(output.refreshToken).toBe('refresh-token');
  });

  it('refresh should reject missing token record', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user_1', familyId: 'family_1', tokenId: 'token_1', type: 'refresh' });
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(service.refresh({ refreshToken: 'refresh-token' })).rejects.toThrow(UnauthorizedException);
  });

  it('refresh should revoke old token and issue a new pair', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user_1', familyId: 'family_1', tokenId: 'token_1', type: 'refresh' });
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token_1',
      userId: 'user_1',
      familyId: 'family_1',
      tokenHash: 'hash',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      revokedAt: null,
    });
    jest.mocked(argon2.verify).mockResolvedValue(true as never);
    prisma.refreshToken.update.mockResolvedValue({ id: 'token_1' });
    prisma.refreshToken.create.mockResolvedValue({ id: 'token_2' });
    jwt.signAsync
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      email: 'john@example.com',
      status: 'active',
      userRoles: [
        {
          role: {
            code: 'customer',
            rolePermissions: [],
          },
        },
      ],
    });
    jest.mocked(argon2.hash).mockResolvedValue('refresh-token-hash' as never);

    const output = await service.refresh({ refreshToken: 'refresh-token' });

    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'token_1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(output.accessToken).toBe('access-token');
  });

  it('logout should revoke the refresh token family entry', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user_1', familyId: 'family_1', tokenId: 'token_1', type: 'refresh' });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const output = await service.logout({ refreshToken: 'refresh-token' });

    expect(output).toEqual({ success: true });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'token_1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('getUserClaims should reject inactive users', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'john@example.com', status: 'inactive' });

    await expect(service.getUserClaims('user_1')).rejects.toThrow(UnauthorizedException);
  });

  it('getUserClaims should return deduplicated roles and permissions', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user_1',
      email: 'john@example.com',
      status: 'active',
      userRoles: [
        {
          role: {
            code: 'customer',
            rolePermissions: [
              { permission: { code: 'read' } },
              { permission: { code: 'read' } },
            ],
          },
        },
      ],
    });

    const output = await service.getUserClaims('user_1');

    expect(output.roles).toEqual(['customer']);
    expect(output.permissions).toEqual(['read']);
  });
});
