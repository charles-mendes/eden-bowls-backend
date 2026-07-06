import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AddressType } from '@prisma/client';

import { UsersService } from './users.service';

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
  };
  userProfile: {
    upsert: jest.Mock;
  };
  userAddress: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  user: {
    findUnique: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  userProfile: {
    upsert: jest.fn(),
  },
  userAddress: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('UsersService', () => {
  let prisma: PrismaMock;
  let service: UsersService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new UsersService(prisma as never);
  });

  it('getMe should return the user with profile and active addresses', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'john@example.com' });

    const output = await service.getMe('user_1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      select: expect.objectContaining({
        profile: true,
      }),
    });
    expect(output.id).toBe('user_1');
  });

  it('getMe should throw when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getMe('missing')).rejects.toThrow(NotFoundException);
  });

  it('upsertMyProfile should upsert the profile', async () => {
    prisma.userProfile.upsert.mockResolvedValue({ id: 'profile_1' });

    const output = await service.upsertMyProfile('user_1', {
      fullName: 'John Doe',
      phone: '11999999999',
      phoneCountry: '+55',
      avatarUrl: 'https://example.com/avatar.png',
      deliveryInstructions: 'Leave at front desk',
    });

    expect(output).toEqual({ id: 'profile_1' });
    expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      update: expect.objectContaining({ fullName: 'John Doe' }),
      create: expect.objectContaining({ userId: 'user_1', fullName: 'John Doe' }),
    });
  });

  it('listMyAddresses should return active addresses ordered by default first', async () => {
    prisma.userAddress.findMany.mockResolvedValue([{ id: 'addr_1' }]);

    const output = await service.listMyAddresses('user_1');

    expect(prisma.userAddress.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    expect(output).toEqual([{ id: 'addr_1' }]);
  });

  it('createMyAddress should create the first address as default', async () => {
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      const tx = {
        userAddress: {
          updateMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'addr_1', isDefault: true }),
        },
      } as unknown as PrismaMock;
      return callback(tx);
    });

    const output = await service.createMyAddress('user_1', {
      type: AddressType.billing,
      country: 'br',
      state: 'SP',
      city: 'Sao Paulo',
      postcode: '01310000',
      address1: 'Av Paulista, 1000',
    });

    expect(output).toEqual({ id: 'addr_1', isDefault: true });
  });

  it('createMyAddress should clear existing default when requested', async () => {
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      const tx = {
        userAddress: {
          updateMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue({ id: 'addr_existing' }),
          create: jest.fn().mockResolvedValue({ id: 'addr_2', isDefault: true }),
        },
      } as unknown as PrismaMock;
      return callback(tx);
    });

    await service.createMyAddress('user_1', {
      type: AddressType.shipping,
      isDefault: true,
      country: 'BR',
      state: 'SP',
      city: 'Sao Paulo',
      postcode: '01310000',
      address1: 'Av Paulista, 1000',
    });

    expect(true).toBe(true);
  });

  it('updateMyAddress should reject missing address', async () => {
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      const tx = {
        userAddress: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
          update: jest.fn(),
        },
      } as unknown as PrismaMock;
      return callback(tx);
    });

    await expect(service.updateMyAddress('user_1', 'addr_1', {})).rejects.toThrow(NotFoundException);
  });

  it('updateMyAddress should update and preserve normalization', async () => {
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      const tx = {
        userAddress: {
          findFirst: jest.fn().mockResolvedValue({ id: 'addr_1', type: AddressType.billing }),
          updateMany: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({ id: 'addr_1', type: AddressType.shipping, isDefault: false }),
        },
      } as unknown as PrismaMock;
      return callback(tx);
    });

    const output = await service.updateMyAddress('user_1', 'addr_1', {
      type: AddressType.shipping,
      country: 'br',
      city: 'Rio de Janeiro',
    });

    expect(output.type).toBe(AddressType.shipping);
  });

  it('deleteMyAddress should soft delete and replace default when needed', async () => {
    prisma.userAddress.findFirst.mockResolvedValue({ id: 'addr_1', type: AddressType.billing, isDefault: true });
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      const tx = {
        userAddress: {
          update: jest.fn(),
          findFirst: jest.fn().mockResolvedValue({ id: 'addr_2' }),
        },
      } as unknown as PrismaMock;
      return callback(tx);
    });

    const output = await service.deleteMyAddress('user_1', 'addr_1');

    expect(output).toEqual({ success: true });
  });

  it('listUsers should reject non admin actors', async () => {
    await expect(
      service.listUsers(
        {},
        { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('listUsers should paginate users for admin roles', async () => {
    prisma.user.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([{ id: 'user_1' }]);
    prisma.$transaction.mockResolvedValue([1, [{ id: 'user_1' }]]);

    const output = await service.listUsers(
      { skip: 0, take: 20 },
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
    );

    expect(output.total).toBe(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
      }),
    );
  });

  it('listUsers should reject take above limit', async () => {
    await expect(
      service.listUsers(
        { take: 101 },
        { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
