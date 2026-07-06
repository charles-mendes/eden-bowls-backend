import { Type } from 'class-transformer';
import {
  IsArray,
  IsJSON,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsNumber } from 'class-validator';

class CreateSubscriptionItemDto {
  @IsUUID()
  variantId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

export class CreateSubscriptionDto {
  @IsOptional()
  @IsUUID()
  checkoutOrderId?: string;

  @IsString()
  paymentMethodId!: string;

  @IsUUID()
  termId!: string;

  @IsOptional()
  @IsString()
  providerSubscriptionId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSubscriptionItemDto)
  items?: CreateSubscriptionItemDto[];

  @IsOptional()
  @IsJSON()
  recurrenceJson?: string;

  @IsOptional()
  @IsJSON()
  planSnapshotJson?: string;
}
