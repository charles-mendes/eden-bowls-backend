import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class StripeWebhookDto {
  @IsString()
  @MinLength(3)
  eventId!: string;

  @IsString()
  @MinLength(3)
  eventType!: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
