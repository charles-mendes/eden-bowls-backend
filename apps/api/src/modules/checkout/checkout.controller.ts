import { Body, Controller, Headers, Param, Post } from '@nestjs/common';

import { CreateCheckoutRequestDto } from './dto/create-checkout-request.dto';
import { PaymentIntentAckDto } from './dto/payment-intent-ack.dto';
import { CheckoutService } from './checkout.service';

@Controller('onboarding/sessions/:sessionId')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('checkout')
  createCheckout(
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateCheckoutRequestDto,
  ) {
    return this.checkoutService.createCheckoutOrder(sessionId, idempotencyKey, body);
  }

  @Post('payment-intent/ack')
  ackPaymentIntent(
    @Param('sessionId') sessionId: string,
    @Body() body: PaymentIntentAckDto,
  ) {
    return this.checkoutService.acknowledgePaymentIntent(sessionId, body);
  }
}
