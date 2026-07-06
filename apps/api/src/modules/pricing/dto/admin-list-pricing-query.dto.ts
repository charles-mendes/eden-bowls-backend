import { Transform } from 'class-transformer';
import {
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class AdminListPricingQueryDto {
  @IsOptional()
  @IsISO31661Alpha2()
  market?: string;

  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}
