import { OrderStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  toStatus!: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
