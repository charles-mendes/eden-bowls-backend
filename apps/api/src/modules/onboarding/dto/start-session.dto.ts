import { IsISO31661Alpha2, IsOptional, IsString, MaxLength } from 'class-validator';

export class StartSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsISO31661Alpha2()
  country!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;
}
