import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class CreateVariantPriceInputDto {
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
  @IsString()
  saleFrom?: string;

  @IsOptional()
  @IsString()
  saleTo?: string;

  @IsString()
  @MaxLength(80)
  source!: string;
}

class CreateVariantInputDto {
  @IsString()
  @MaxLength(120)
  sku!: string;

  @IsString()
  @MaxLength(120)
  flavorKey!: string;

  @IsString()
  @MaxLength(80)
  weightLabel!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  grams!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantPriceInputDto)
  prices?: CreateVariantPriceInputDto[];
}

class CreateMarketConfigInputDto {
  @IsISO31661Alpha2()
  marketCountry!: string;

  @IsISO4217CurrencyCode()
  currency!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  planDays!: number;

  @IsOptional()
  @IsBoolean()
  isPlanProduct?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AdminCreateProductDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @Length(2, 120)
  slug!: string;

  @IsString()
  @Length(2, 150)
  namePt!: string;

  @IsString()
  @Length(2, 150)
  nameEn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionPt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionEn?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMarketConfigInputDto)
  marketConfigs?: CreateMarketConfigInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantInputDto)
  variants?: CreateVariantInputDto[];
}
