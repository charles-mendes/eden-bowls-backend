import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmailsService } from './emails.service';
import { EmailDeliveryResultDto } from './dto/email-delivery-result.dto';
import { ListEmailMessagesQueryDto } from './dto/list-email-messages-query.dto';
import { SendEmailCommandDto } from './dto/send-email-command.dto';

@Controller('emails')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class EmailsController {
  constructor(private readonly emailsService: EmailsService) {}

  @Post('queue')
  queue(@Body() body: SendEmailCommandDto) {
    return this.emailsService.queueEmail(body);
  }

  @Post('send')
  send(@Body() body: SendEmailCommandDto) {
    return this.emailsService.sendTransactionalEmail(body);
  }

  @Patch(':id/delivery-result')
  markDeliveryResult(@Param('id') id: string, @Body() body: EmailDeliveryResultDto) {
    return this.emailsService.markDeliveryResult(id, body);
  }

  @Get()
  list(@Query() query: ListEmailMessagesQueryDto) {
    return this.emailsService.listEmailMessages(query);
  }
}
