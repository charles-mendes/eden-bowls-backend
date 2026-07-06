import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { WebhookState } from '@prisma/client';

export class AdminWebhooksQueryDto {
  @IsOptional()
  @IsEnum(WebhookState)
  state?: WebhookState;

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
