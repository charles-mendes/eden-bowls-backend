import { IsISO31661Alpha2, IsOptional, IsString, IsUUID, MaxLength, IsNumber, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class PlanPreviewRequestDto {
  @IsOptional()
  @IsISO31661Alpha2()
  marketCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  shippingAmount?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsUUID()
  snapshotId?: string;
}
