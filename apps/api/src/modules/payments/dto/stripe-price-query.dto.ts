import { IsISO4217CurrencyCode } from 'class-validator';

export class StripePriceQueryDto {
  @IsISO4217CurrencyCode()
  currency!: string;
}
