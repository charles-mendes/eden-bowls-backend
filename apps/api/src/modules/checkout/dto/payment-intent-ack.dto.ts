import { IsIn, IsString, MinLength } from 'class-validator';

export class PaymentIntentAckDto {
  @IsString()
  @MinLength(3)
  paymentIntentId!: string;

  @IsIn(['processing', 'succeeded', 'failed'])
  status!: 'processing' | 'succeeded' | 'failed';
}
