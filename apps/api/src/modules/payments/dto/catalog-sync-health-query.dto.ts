import { IsISO31661Alpha2, IsISO4217CurrencyCode } from 'class-validator';

export class CatalogSyncHealthQueryDto {
  @IsISO31661Alpha2()
  market!: string;

  @IsISO4217CurrencyCode()
  currency!: string;
}
