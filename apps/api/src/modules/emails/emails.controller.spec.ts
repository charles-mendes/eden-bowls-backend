import { EmailMessageStatus } from '@prisma/client';

import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';

type EmailsServiceMock = {
  queueEmail: jest.Mock;
  sendTransactionalEmail: jest.Mock;
  markDeliveryResult: jest.Mock;
  listEmailMessages: jest.Mock;
};

const makeServiceMock = (): EmailsServiceMock => ({
  queueEmail: jest.fn(),
  sendTransactionalEmail: jest.fn(),
  markDeliveryResult: jest.fn(),
  listEmailMessages: jest.fn(),
});

describe('EmailsController', () => {
  let service: EmailsServiceMock;
  let controller: EmailsController;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new EmailsController(service as unknown as EmailsService);
  });

  it('queue should delegate to EmailsService.queueEmail', async () => {
    service.queueEmail.mockResolvedValue({ id: 'em_1' });
    const body = {
      templateKey: 'welcome',
      recipientEmail: 'john@example.com',
      payload: { firstName: 'John' },
    };

    const output = await controller.queue(body);

    expect(service.queueEmail).toHaveBeenCalledWith(body);
    expect(output).toEqual({ id: 'em_1' });
  });

  it('send should delegate to EmailsService.sendTransactionalEmail', async () => {
    service.sendTransactionalEmail.mockResolvedValue({ id: 'em_2', status: EmailMessageStatus.sent });
    const body = {
      templateKey: 'checkout_success',
      recipientEmail: 'ana@example.com',
      payload: { orderId: 'ord_1' },
    };

    const output = await controller.send(body);

    expect(service.sendTransactionalEmail).toHaveBeenCalledWith(body);
    expect(output).toEqual({ id: 'em_2', status: EmailMessageStatus.sent });
  });

  it('markDeliveryResult should delegate to EmailsService.markDeliveryResult', async () => {
    service.markDeliveryResult.mockResolvedValue({ id: 'em_3', status: EmailMessageStatus.failed });
    const body = { status: EmailMessageStatus.failed, errorMessage: 'bounce' };

    const output = await controller.markDeliveryResult('em_3', body);

    expect(service.markDeliveryResult).toHaveBeenCalledWith('em_3', body);
    expect(output).toEqual({ id: 'em_3', status: EmailMessageStatus.failed });
  });

  it('list should delegate to EmailsService.listEmailMessages', async () => {
    service.listEmailMessages.mockResolvedValue({ items: [], page: 1, perPage: 20, total: 0, totalPages: 0 });
    const query = { page: 1, perPage: 20 };

    const output = await controller.list(query);

    expect(service.listEmailMessages).toHaveBeenCalledWith(query);
    expect(output).toEqual({ items: [], page: 1, perPage: 20, total: 0, totalPages: 0 });
  });
});