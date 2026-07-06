import { Body, Controller, Param, Post } from '@nestjs/common';

import { CreateShippingQuoteDto } from './dto/create-shipping-quote.dto';
import { SelectShippingRateDto } from './dto/select-shipping-rate.dto';
import { ShippingService } from './shipping.service';

@Controller('onboarding/sessions/:sessionId/shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('quote')
  createQuote(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateShippingQuoteDto,
  ) {
    return this.shippingService.createQuote(sessionId, body);
  }

  @Post('select')
  selectRate(
    @Param('sessionId') sessionId: string,
    @Body() body: SelectShippingRateDto,
  ) {
    return this.shippingService.selectRate(sessionId, body);
  }
}
