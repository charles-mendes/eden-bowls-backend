import { IsISO31661Alpha2, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListCategoriesQueryDto {
  @IsOptional()
  @IsISO31661Alpha2()
  market?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  locale?: string;
}
