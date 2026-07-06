import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class ShippingDestinationDto {
  @IsISO31661Alpha2()
  country!: string;

  @IsString()
  @MaxLength(30)
  postcode!: string;
}

class ShippingItemDto {
  @IsOptional()
  @IsString()
  sku?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class CreateShippingQuoteDto {
  @ValidateNested()
  @Type(() => ShippingDestinationDto)
  destination!: ShippingDestinationDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShippingItemDto)
  items!: ShippingItemDto[];

  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;
}
