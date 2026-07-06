import { SubscriptionStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListSubscriptionsQueryDto {
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;
}
