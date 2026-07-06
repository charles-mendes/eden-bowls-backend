import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpsertProfileDto {
  @IsString()
  @Length(2, 150)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  phoneCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliveryInstructions?: string;
}
