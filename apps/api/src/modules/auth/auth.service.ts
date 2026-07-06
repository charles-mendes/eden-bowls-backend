import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessExpiresIn: string;
  refreshExpiresIn: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(input: RegisterDto): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('Email already registered');
    }

    const passwordHash = await argon2.hash(input.password);
    const user = await this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash,
        status: 'active',
      },
      select: { id: true },
    });

    const customerRole = await this.prisma.role.findUnique({
      where: { code: 'customer' },
      select: { id: true },
    });

    if (customerRole) {
      await this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: customerRole.id,
        },
      });
    }

    return this.issueTokenPair(user.id);
  }

  async login(input: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        status: true,
        passwordHash: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('User is not active');
    }

    const passwordOk = await argon2.verify(user.passwordHash, input.password);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokenPair(user.id);
  }

  async refresh(input: RefreshDto): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(input.refreshToken);

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { id: payload.tokenId },
      select: {
        id: true,
        userId: true,
        familyId: true,
        tokenHash: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Refresh token not found');
    }

    if (tokenRecord.revokedAt) {
      throw new UnauthorizedException('Refresh token revoked');
    }

    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const match = await argon2.verify(tokenRecord.tokenHash, input.refreshToken);
    if (!match) {
      throw new UnauthorizedException('Refresh token mismatch');
    }

    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(tokenRecord.userId, tokenRecord.familyId);
  }

  async logout(input: { refreshToken: string }): Promise<{ success: true }> {
    const payload = await this.verifyRefreshToken(input.refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: {
        id: payload.tokenId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return { success: true };
  }

  async getUserClaims(userId: string): Promise<{
    userId: string;
    email: string;
    roles: string[];
    permissions: string[];
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        userRoles: {
          select: {
            role: {
              select: {
                code: true,
                rolePermissions: {
                  select: {
                    permission: {
                      select: { code: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('User not available');
    }

    const roles = user.userRoles.map((ur) => ur.role.code);
    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
      ),
    );

    return {
      userId: user.id,
      email: user.email,
      roles,
      permissions,
    };
  }

  private async issueTokenPair(
    userId: string,
    familyId?: string,
  ): Promise<TokenPair> {
    const claims = await this.getUserClaims(userId);
    const accessSecret = process.env.JWT_ACCESS_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    const accessExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
    const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN ?? '30d';

    if (!accessSecret || !refreshSecret) {
      throw new BadRequestException('JWT secrets are not configured');
    }

    const tokenFamilyId = familyId ?? randomUUID();
    const tokenId = randomUUID();

    const accessToken = await this.jwtService.signAsync(
      {
        sub: claims.userId,
        email: claims.email,
        roles: claims.roles,
        permissions: claims.permissions,
        type: 'access',
      },
      {
        secret: accessSecret,
        expiresIn: accessExpiresIn,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        sub: claims.userId,
        type: 'refresh',
        familyId: tokenFamilyId,
        tokenId,
      },
      {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn,
      },
    );

    const refreshTokenHash = await argon2.hash(refreshToken);

    await this.prisma.refreshToken.create({
      data: {
        id: tokenId,
        userId: claims.userId,
        familyId: tokenFamilyId,
        tokenHash: refreshTokenHash,
        expiresAt: this.resolveFutureDate(refreshExpiresIn),
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      accessExpiresIn,
      refreshExpiresIn,
    };
  }

  private async verifyRefreshToken(token: string): Promise<{
    sub: string;
    familyId: string;
    tokenId: string;
    type: 'refresh';
  }> {
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        familyId: string;
        tokenId: string;
        type: 'refresh';
      }>(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private resolveFutureDate(expiresIn: string): Date {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    const value = Number(match[1]);
    const unit = match[2];

    const unitToMs: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + value * unitToMs[unit]);
  }
}
