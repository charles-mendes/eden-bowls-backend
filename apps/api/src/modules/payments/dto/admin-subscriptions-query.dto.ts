import { Transform } from 'class-transformer';
import { IsEnum, IsISO31661Alpha2, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SubscriptionStatus } from '@prisma/client';

export class AdminSubscriptionsQueryDto {
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsISO31661Alpha2()
  market?: string;

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
