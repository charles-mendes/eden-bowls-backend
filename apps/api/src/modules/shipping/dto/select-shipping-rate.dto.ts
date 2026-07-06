import { IsUUID } from 'class-validator';

export class SelectShippingRateDto {
  @IsUUID()
  quoteId!: string;

  @IsUUID()
  rateId!: string;
}
