import { NotFoundException } from '@nestjs/common';
import { EmailMessageStatus } from '@prisma/client';

import { EmailsService } from './emails.service';

type PrismaMock = {
  emailMessage: {
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  $transaction: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  emailMessage: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('EmailsService', () => {
  let prisma: PrismaMock;
  let service: EmailsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new EmailsService(prisma as never);
  });

  it('queueEmail should default provider to sendgrid', async () => {
    const created = { id: 'em_1' };
    prisma.emailMessage.create.mockResolvedValue(created);

    const output = await service.queueEmail({
      templateKey: 'welcome',
      recipientEmail: 'john@example.com',
      payload: { firstName: 'John' },
    });

    expect(output).toEqual(created);
    expect(prisma.emailMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateKey: 'welcome',
        recipientEmail: 'john@example.com',
        provider: 'sendgrid',
        status: EmailMessageStatus.queued,
      }),
    });
  });

  it('sendTransactionalEmail should queue and mark message as sent', async () => {
    prisma.emailMessage.create.mockResolvedValue({ id: 'em_2' });
    prisma.emailMessage.update.mockResolvedValue({ id: 'em_2', status: EmailMessageStatus.sent });

    const output = await service.sendTransactionalEmail({
      templateKey: 'checkout_success',
      recipientEmail: 'ana@example.com',
      provider: 'ses',
      payload: { orderId: 'ord_1' },
    });

    expect(output).toEqual({ id: 'em_2', status: EmailMessageStatus.sent });
    expect(prisma.emailMessage.update).toHaveBeenCalledWith({
      where: { id: 'em_2' },
      data: expect.objectContaining({
        status: EmailMessageStatus.sent,
        errorMessage: null,
        sentAt: expect.any(Date),
      }),
    });
  });

  it('markDeliveryResult should throw when email message does not exist', async () => {
    prisma.emailMessage.findUnique.mockResolvedValue(null);

    await expect(
      service.markDeliveryResult('missing_id', {
        status: EmailMessageStatus.failed,
        errorMessage: 'bounce',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('listEmailMessages should return paginated response', async () => {
    const findManyPromise = Promise.resolve([{ id: 'em_3' }]);
    const countPromise = Promise.resolve(1);
    prisma.emailMessage.findMany.mockReturnValue(findManyPromise);
    prisma.emailMessage.count.mockReturnValue(countPromise);
    prisma.$transaction.mockResolvedValue([[{ id: 'em_3' }], 1]);

    const output = await service.listEmailMessages({
      status: EmailMessageStatus.queued,
      page: 1,
      perPage: 20,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(output).toEqual({
      items: [{ id: 'em_3' }],
      page: 1,
      perPage: 20,
      total: 1,
      totalPages: 1,
    });
  });
});