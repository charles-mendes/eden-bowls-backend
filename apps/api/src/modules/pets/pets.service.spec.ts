import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PetSex, PetSpecies } from '@prisma/client';

import { PetsService } from './pets.service';

type PrismaMock = {
  breed: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
  };
  pet: {
    findMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
};

const makePrismaMock = (): PrismaMock => ({
  breed: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  pet: {
    findMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
});

describe('PetsService', () => {
  let prisma: PrismaMock;
  let service: PetsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new PetsService(prisma as never);
  });

  it('listBreeds should return locale-aware names', async () => {
    prisma.breed.findMany.mockResolvedValue([
      {
        id: 'breed_1',
        species: PetSpecies.dog,
        namePt: 'Labrador',
        nameEn: 'Labrador Retriever',
        size: 'large',
      },
    ]);

    const output = await service.listBreeds({ locale: 'en-US' });

    expect(prisma.breed.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ species: 'asc' }, { namePt: 'asc' }],
      select: {
        id: true,
        species: true,
        namePt: true,
        nameEn: true,
        size: true,
      },
    });
    expect(output).toEqual([
      {
        id: 'breed_1',
        species: PetSpecies.dog,
        name: 'Labrador Retriever',
        namePt: 'Labrador',
        nameEn: 'Labrador Retriever',
        size: 'large',
      },
    ]);
  });

  it('listMyPets should filter by user and deletedAt', async () => {
    prisma.pet.findMany.mockResolvedValue([{ id: 'pet_1' }]);

    const output = await service.listMyPets('user_1');

    expect(prisma.pet.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        breed: {
          select: {
            id: true,
            species: true,
            namePt: true,
            nameEn: true,
            size: true,
          },
        },
      },
    });
    expect(output).toEqual([{ id: 'pet_1' }]);
  });

  it('createPet should reject an unknown breed', async () => {
    prisma.breed.findUnique.mockResolvedValue(null);

    await expect(
      service.createPet('user_1', {
        name: 'Thor',
        species: PetSpecies.dog,
        breedId: 'breed_1',
        weightKg: 12,
        neutered: true,
        activityLevel: 'moderate',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('createPet should reject breed species mismatch', async () => {
    prisma.breed.findUnique.mockResolvedValue({ id: 'breed_1', species: PetSpecies.cat });

    await expect(
      service.createPet('user_1', {
        name: 'Thor',
        species: PetSpecies.dog,
        breedId: 'breed_1',
        weightKg: 12,
        neutered: true,
        activityLevel: 'moderate',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('createPet should create a pet with normalized payload', async () => {
    prisma.breed.findUnique.mockResolvedValue({ id: 'breed_1', species: PetSpecies.dog });
    prisma.pet.create.mockResolvedValue({ id: 'pet_1' });

    const output = await service.createPet('user_1', {
      name: 'Thor',
      species: PetSpecies.dog,
      breedId: 'breed_1',
      sex: PetSex.male,
      birthDate: '2026-01-01',
      weightKg: 12.5,
      neutered: true,
      activityLevel: 'moderate',
      bodyConditionScore: 5,
      nutritionGoal: 'maintenance',
      restrictionsJson: { grainFree: true },
    } as never);

    expect(output).toEqual({ id: 'pet_1' });
    expect(prisma.pet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user_1',
        name: 'Thor',
        species: PetSpecies.dog,
        breedId: 'breed_1',
        sex: PetSex.male,
        birthDate: new Date('2026-01-01'),
        neutered: true,
        activityLevel: 'moderate',
        bodyConditionScore: 5,
        nutritionGoal: 'maintenance',
      }),
    });
  });

  it('updatePet should reject missing pet', async () => {
    prisma.pet.findFirst.mockResolvedValue(null);

    await expect(service.updatePet('user_1', 'pet_1', {} as never)).rejects.toThrow(NotFoundException);
  });

  it('updatePet should validate breed changes against next species', async () => {
    prisma.pet.findFirst.mockResolvedValue({ id: 'pet_1', species: PetSpecies.dog });
    prisma.breed.findUnique.mockResolvedValue({ id: 'breed_1', species: PetSpecies.cat });

    await expect(
      service.updatePet('user_1', 'pet_1', {
        species: PetSpecies.dog,
        breedId: 'breed_1',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('updatePet should update pet fields', async () => {
    prisma.pet.findFirst.mockResolvedValue({ id: 'pet_1', species: PetSpecies.dog });
    prisma.breed.findUnique.mockResolvedValue({ id: 'breed_1', species: PetSpecies.dog });
    prisma.pet.update.mockResolvedValue({ id: 'pet_1', name: 'Bolt' });

    const output = await service.updatePet('user_1', 'pet_1', {
      name: 'Bolt',
      breedId: 'breed_1',
      weightKg: 14,
      restrictionsJson: { chicken: false },
    } as never);

    expect(output).toEqual({ id: 'pet_1', name: 'Bolt' });
    expect(prisma.pet.update).toHaveBeenCalledWith({
      where: { id: 'pet_1' },
      data: expect.objectContaining({
        name: 'Bolt',
        breedId: 'breed_1',
        weightKg: expect.any(Object),
      }),
    });
  });

  it('deletePet should soft delete owned pet', async () => {
    prisma.pet.findFirst.mockResolvedValue({ id: 'pet_1' });
    prisma.pet.update.mockResolvedValue({ id: 'pet_1' });

    const output = await service.deletePet('user_1', 'pet_1');

    expect(output).toEqual({ success: true });
    expect(prisma.pet.update).toHaveBeenCalledWith({
      where: { id: 'pet_1' },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });
  });

  it('deletePet should reject missing pet', async () => {
    prisma.pet.findFirst.mockResolvedValue(null);

    await expect(service.deletePet('user_1', 'pet_1')).rejects.toThrow(NotFoundException);
  });
});
