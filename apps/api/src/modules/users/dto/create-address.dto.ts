import { AddressType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateAddressDto {
  @IsEnum(AddressType)
  type!: AddressType;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsISO31661Alpha2()
  country!: string;

  @IsString()
  @MaxLength(80)
  state!: string;

  @IsString()
  @MaxLength(120)
  city!: string;

  @IsString()
  @MaxLength(30)
  postcode!: string;

  @IsString()
  @MaxLength(255)
  address1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address2?: string;
}
