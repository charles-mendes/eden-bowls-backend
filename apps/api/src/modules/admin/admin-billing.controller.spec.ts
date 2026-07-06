import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';

describe('AdminBillingController', () => {
  let service: {
    listWebhookEvents: jest.Mock;
    listSubscriptions: jest.Mock;
  };
  let controller: AdminBillingController;

  beforeEach(() => {
    service = {
      listWebhookEvents: jest.fn(),
      listSubscriptions: jest.fn(),
    };
    controller = new AdminBillingController(service as unknown as AdminBillingService);
  });

  it('listWebhookEvents should delegate to service', async () => {
    service.listWebhookEvents.mockResolvedValue({ total: 1 });

    const output = await controller.listWebhookEvents({ page: 1, perPage: 20 });

    expect(service.listWebhookEvents).toHaveBeenCalledWith({ page: 1, perPage: 20 });
    expect(output).toEqual({ total: 1 });
  });

  it('listSubscriptions should delegate to service', async () => {
    service.listSubscriptions.mockResolvedValue({ total: 1 });

    const output = await controller.listSubscriptions({ page: 1, perPage: 20 });

    expect(service.listSubscriptions).toHaveBeenCalledWith({ page: 1, perPage: 20 });
    expect(output).toEqual({ total: 1 });
  });
});
