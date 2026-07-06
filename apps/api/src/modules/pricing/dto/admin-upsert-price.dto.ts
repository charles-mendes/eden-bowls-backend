import { Type } from 'class-transformer';
import {
  IsDateString,
  IsISO4217CurrencyCode,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class AdminUpsertPriceDto {
  @IsUUID()
  variantId!: string;

  @IsISO4217CurrencyCode()
  currency!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  regularPrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @IsDateString()
  saleFrom?: string;

  @IsOptional()
  @IsDateString()
  saleTo?: string;

  @IsString()
  @MaxLength(80)
  source!: string;
}
