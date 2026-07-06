import { IsISO31661Alpha2, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveZipcodeDto {
  @IsString()
  @MaxLength(30)
  postcode!: string;

  @IsOptional()
  @IsISO31661Alpha2()
  country?: string;
}
