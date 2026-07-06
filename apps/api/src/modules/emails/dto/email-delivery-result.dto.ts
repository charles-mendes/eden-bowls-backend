import { EmailMessageStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class EmailDeliveryResultDto {
  @IsEnum(EmailMessageStatus)
  status!: EmailMessageStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  errorMessage?: string;
}
