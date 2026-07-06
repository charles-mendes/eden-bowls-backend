import { Transform } from 'class-transformer';
import { EmailMessageStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListEmailMessagesQueryDto {
  @IsOptional()
  @IsEnum(EmailMessageStatus)
  status?: EmailMessageStatus;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

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
