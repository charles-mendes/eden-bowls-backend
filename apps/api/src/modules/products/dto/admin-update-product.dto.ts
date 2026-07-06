import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class AdminUpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(2, 150)
  namePt?: string;

  @IsOptional()
  @IsString()
  @Length(2, 150)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionPt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionEn?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
