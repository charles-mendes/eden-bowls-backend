import {
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ListVariantsQueryDto {
  @IsOptional()
  @IsISO31661Alpha2()
  market?: string;

  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  locale?: string;
}
