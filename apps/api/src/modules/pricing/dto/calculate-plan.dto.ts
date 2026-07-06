import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class CalculatePlanPetDto {
  @Type(() => Number)
  @IsOptional()
  @Min(0.1)
  @Max(300)
  weightKg?: number;
}

export class CalculatePlanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CalculatePlanPetDto)
  pets!: CalculatePlanPetDto[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  termMonths!: number;

  @IsISO31661Alpha2()
  market!: string;

  @IsISO4217CurrencyCode()
  currency!: string;
}
