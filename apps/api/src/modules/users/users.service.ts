import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuthUser } from '../auth/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UpsertProfileDto } from './dto/upsert-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        profile: true,
        addresses: {
          where: { deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async upsertMyProfile(userId: string, input: UpsertProfileDto) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      update: {
        fullName: input.fullName,
        phone: input.phone,
        phoneCountry: input.phoneCountry,
        avatarUrl: input.avatarUrl,
        deliveryInstructions: input.deliveryInstructions,
      },
      create: {
        userId,
        fullName: input.fullName,
        phone: input.phone,
        phoneCountry: input.phoneCountry,
        avatarUrl: input.avatarUrl,
        deliveryInstructions: input.deliveryInstructions,
      },
    });
  }

  async listMyAddresses(userId: string) {
    return this.prisma.userAddress.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createMyAddress(userId: string, input: CreateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.userAddress.updateMany({
          where: {
            userId,
            type: input.type,
            deletedAt: null,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      const shouldDefault = await this.shouldSetAsDefault(
        tx,
        userId,
        input.type,
        input.isDefault,
      );

      return tx.userAddress.create({
        data: {
          userId,
          type: input.type,
          isDefault: shouldDefault,
          country: input.country.toUpperCase(),
          state: input.state,
          city: input.city,
          postcode: input.postcode,
          address1: input.address1,
          address2: input.address2,
        },
      });
    });
  }

  async updateMyAddress(userId: string, addressId: string, input: UpdateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.userAddress.findFirst({
        where: {
          id: addressId,
          userId,
          deletedAt: null,
        },
      });

      if (!current) {
        throw new NotFoundException('Address not found');
      }

      if (input.type && input.type !== current.type && input.isDefault) {
        await tx.userAddress.updateMany({
          where: {
            userId,
            type: input.type,
            deletedAt: null,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      } else if (input.isDefault) {
        await tx.userAddress.updateMany({
          where: {
            userId,
            type: current.type,
            deletedAt: null,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      const nextType = input.type ?? current.type;
      const shouldDefault = await this.shouldSetAsDefault(
        tx,
        userId,
        nextType,
        input.isDefault,
        current.id,
      );

      const data: Prisma.UserAddressUpdateInput = {
        type: input.type,
        isDefault: shouldDefault,
        country: input.country?.toUpperCase(),
        state: input.state,
        city: input.city,
        postcode: input.postcode,
        address1: input.address1,
        address2: input.address2,
      };

      return tx.userAddress.update({
        where: { id: current.id },
        data,
      });
    });
  }

  async deleteMyAddress(userId: string, addressId: string) {
    const current = await this.prisma.userAddress.findFirst({
      where: {
        id: addressId,
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
        type: true,
        isDefault: true,
      },
    });

    if (!current) {
      throw new NotFoundException('Address not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userAddress.update({
        where: { id: current.id },
        data: {
          deletedAt: new Date(),
          isDefault: false,
        },
      });

      if (current.isDefault) {
        const replacement = await tx.userAddress.findFirst({
          where: {
            userId,
            type: current.type,
            deletedAt: null,
            id: { not: current.id },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (replacement) {
          await tx.userAddress.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }
    });

    return { success: true };
  }

  async listUsers(query: ListUsersQueryDto, actor: AuthUser) {
    const allowedRoles = ['admin', 'operator', 'readonly'];
    const canList = actor.roles.some((role) => allowedRoles.includes(role));
    if (!canList) {
      throw new ForbiddenException('Insufficient role to list users');
    }

    const skip = query.skip ?? 0;
    const take = query.take ?? 20;

    if (take > 100) {
      throw new BadRequestException('take must be <= 100');
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          profile: {
            select: {
              fullName: true,
              phone: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items,
    };
  }

  private async shouldSetAsDefault(
    tx: Prisma.TransactionClient,
    userId: string,
    type: 'billing' | 'shipping',
    requested?: boolean,
    ignoreId?: string,
  ): Promise<boolean> {
    if (requested === true) {
      return true;
    }

    if (requested === false) {
      return false;
    }

    const existing = await tx.userAddress.findFirst({
      where: {
        userId,
        type,
        deletedAt: null,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
      select: { id: true },
    });

    return !existing;
  }
}
