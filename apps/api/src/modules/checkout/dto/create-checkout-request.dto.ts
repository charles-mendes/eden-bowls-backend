import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  MaxLength,
} from 'class-validator';

class SelectedShippingDto {
  @IsUUID()
  quoteId!: string;

  @IsUUID()
  rateId!: string;
}

class BillingAddressDto {
  @IsString()
  @MaxLength(2)
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

export class CreateCheckoutRequestDto {
  @IsString()
  @MaxLength(191)
  snapshotHash!: string;

  @ValidateNested()
  @Type(() => SelectedShippingDto)
  selectedShipping!: SelectedShippingDto;

  @ValidateNested()
  @Type(() => BillingAddressDto)
  billingAddress!: BillingAddressDto;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
