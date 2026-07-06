import { Injectable, NotFoundException } from '@nestjs/common';
import { EmailMessageStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { EmailDeliveryResultDto } from './dto/email-delivery-result.dto';
import { ListEmailMessagesQueryDto } from './dto/list-email-messages-query.dto';
import { SendEmailCommandDto } from './dto/send-email-command.dto';

@Injectable()
export class EmailsService {
  private readonly fallbackProvider = 'sendgrid';

  constructor(private readonly prisma: PrismaService) {}

  async queueEmail(command: SendEmailCommandDto) {
    return this.prisma.emailMessage.create({
      data: {
        templateKey: command.templateKey,
        recipientEmail: command.recipientEmail,
        provider: command.provider ?? this.fallbackProvider,
        status: EmailMessageStatus.queued,
        payloadJson: command.payload as Prisma.InputJsonValue,
      },
    });
  }

  async sendTransactionalEmail(command: SendEmailCommandDto) {
    const created = await this.queueEmail(command);

    return this.prisma.emailMessage.update({
      where: { id: created.id },
      data: {
        status: EmailMessageStatus.sent,
        sentAt: new Date(),
        errorMessage: null,
      },
    });
  }

  async markDeliveryResult(emailMessageId: string, dto: EmailDeliveryResultDto) {
    const existing = await this.prisma.emailMessage.findUnique({
      where: { id: emailMessageId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Email message not found.');
    }

    return this.prisma.emailMessage.update({
      where: { id: emailMessageId },
      data: {
        status: dto.status,
        errorMessage: dto.status === EmailMessageStatus.failed ? (dto.errorMessage ?? 'Delivery failed.') : null,
        sentAt: dto.status === EmailMessageStatus.sent ? new Date() : null,
      },
    });
  }

  async listEmailMessages(query: ListEmailMessagesQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const where: Prisma.EmailMessageWhereInput = {
      status: query.status,
      recipientEmail: query.recipientEmail,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.emailMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.emailMessage.count({ where }),
    ]);

    return {
      items,
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }
}
