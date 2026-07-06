import { IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendEmailCommandDto {
  @IsString()
  @MaxLength(120)
  templateKey!: string;

  @IsEmail()
  recipientEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  provider?: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
