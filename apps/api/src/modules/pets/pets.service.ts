import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PetSpecies, Prisma } from '@prisma/client';

import { CreatePetDto } from './dto/create-pet.dto';
import { ListBreedsQueryDto } from './dto/list-breeds-query.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PetsService {
  constructor(private readonly prisma: PrismaService) {}

  async listBreeds(query: ListBreedsQueryDto) {
    const locale = (query.locale ?? 'pt').toLowerCase();

    const breeds = await this.prisma.breed.findMany({
      where: {
        ...(query.species ? { species: query.species } : {}),
      },
      orderBy: [{ species: 'asc' }, { namePt: 'asc' }],
      select: {
        id: true,
        species: true,
        namePt: true,
        nameEn: true,
        size: true,
      },
    });

    return breeds.map((breed) => ({
      id: breed.id,
      species: breed.species,
      name: locale.startsWith('en') ? breed.nameEn : breed.namePt,
      namePt: breed.namePt,
      nameEn: breed.nameEn,
      size: breed.size,
    }));
  }

  async listMyPets(userId: string) {
    return this.prisma.pet.findMany({
      where: {
        userId,
        deletedAt: null,
      },
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
  }

  async createPet(userId: string, input: CreatePetDto) {
    await this.validateBreed(input.species, input.breedId);

    return this.prisma.pet.create({
      data: {
        userId,
        name: input.name,
        species: input.species,
        breedId: input.breedId,
        sex: input.sex,
        birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
        weightKg: new Prisma.Decimal(input.weightKg),
        neutered: input.neutered,
        activityLevel: input.activityLevel,
        bodyConditionScore: input.bodyConditionScore,
        nutritionGoal: input.nutritionGoal,
        restrictionsJson:
          input.restrictionsJson === undefined
            ? undefined
            : (input.restrictionsJson as Prisma.InputJsonValue),
      },
    });
  }

  async updatePet(userId: string, petId: string, input: UpdatePetDto) {
    const current = await this.prisma.pet.findFirst({
      where: {
        id: petId,
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
        species: true,
      },
    });

    if (!current) {
      throw new NotFoundException('Pet not found');
    }

    const nextSpecies = input.species ?? current.species;
    await this.validateBreed(nextSpecies, input.breedId);

    return this.prisma.pet.update({
      where: { id: current.id },
      data: {
        name: input.name,
        species: input.species,
        breedId: input.breedId,
        sex: input.sex,
        birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
        weightKg:
          input.weightKg === undefined
            ? undefined
            : new Prisma.Decimal(input.weightKg),
        neutered: input.neutered,
        activityLevel: input.activityLevel,
        bodyConditionScore: input.bodyConditionScore,
        nutritionGoal: input.nutritionGoal,
        restrictionsJson:
          input.restrictionsJson === undefined
            ? undefined
            : (input.restrictionsJson as Prisma.InputJsonValue),
      },
    });
  }

  async deletePet(userId: string, petId: string) {
    const current = await this.prisma.pet.findFirst({
      where: {
        id: petId,
        userId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!current) {
      throw new NotFoundException('Pet not found');
    }

    await this.prisma.pet.update({
      where: { id: current.id },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }

  private async validateBreed(species: PetSpecies, breedId?: string) {
    if (!breedId) {
      return;
    }

    const breed = await this.prisma.breed.findUnique({
      where: { id: breedId },
      select: {
        id: true,
        species: true,
      },
    });

    if (!breed) {
      throw new BadRequestException('Breed not found');
    }

    if (breed.species !== species) {
      throw new BadRequestException('Breed species mismatch');
    }
  }
}
