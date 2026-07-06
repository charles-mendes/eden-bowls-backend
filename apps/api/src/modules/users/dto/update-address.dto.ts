import { AddressType } from '@prisma/client';
import {
	IsBoolean,
	IsEnum,
	IsISO31661Alpha2,
	IsOptional,
	IsString,
	MaxLength,
} from 'class-validator';

export class UpdateAddressDto {
	@IsOptional()
	@IsEnum(AddressType)
	type?: AddressType;

	@IsOptional()
	@IsBoolean()
	isDefault?: boolean;

	@IsOptional()
	@IsISO31661Alpha2()
	country?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	state?: string;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	city?: string;

	@IsOptional()
	@IsString()
	@MaxLength(30)
	postcode?: string;

	@IsOptional()
	@IsString()
	@MaxLength(255)
	address1?: string;

	@IsOptional()
	@IsString()
	@MaxLength(255)
	address2?: string;
}
