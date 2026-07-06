import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PetSex, PetSpecies } from '@prisma/client';

export class UpdatePetDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsEnum(PetSpecies)
  species?: PetSpecies;

  @IsOptional()
  @IsUUID()
  breedId?: string;

  @IsOptional()
  @IsEnum(PetSex)
  sex?: PetSex;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0.1)
  @Max(300)
  weightKg?: number;

  @IsOptional()
  @IsBoolean()
  neutered?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  activityLevel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  bodyConditionScore?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nutritionGoal?: string;

  @IsOptional()
  @IsObject()
  restrictionsJson?: Record<string, unknown>;
}
