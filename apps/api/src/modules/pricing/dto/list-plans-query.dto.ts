import { IsISO31661Alpha2, IsISO4217CurrencyCode, IsOptional } from 'class-validator';

export class ListPlansQueryDto {
  @IsOptional()
  @IsISO31661Alpha2()
  market?: string;

  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;
}
