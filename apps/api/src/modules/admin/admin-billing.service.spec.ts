import { SubscriptionStatus, WebhookState } from '@prisma/client';

import { AdminBillingService } from './admin-billing.service';

describe('AdminBillingService', () => {
  let paymentsService: {
    listWebhookEvents: jest.Mock;
    listAdminSubscriptions: jest.Mock;
  };
  let service: AdminBillingService;

  beforeEach(() => {
    paymentsService = {
      listWebhookEvents: jest.fn(),
      listAdminSubscriptions: jest.fn(),
    };

    service = new AdminBillingService(paymentsService as never);
  });

  it('listWebhookEvents should delegate to PaymentsService.listWebhookEvents', async () => {
    paymentsService.listWebhookEvents.mockResolvedValue({ total: 1, items: [{ id: 'evt_1' }] });

    const output = await service.listWebhookEvents({ state: WebhookState.processed, page: 1, perPage: 20 });

    expect(paymentsService.listWebhookEvents).toHaveBeenCalledWith({
      state: WebhookState.processed,
      page: 1,
      perPage: 20,
    });
    expect(output).toEqual({ total: 1, items: [{ id: 'evt_1' }] });
  });

  it('listSubscriptions should delegate to PaymentsService.listAdminSubscriptions', async () => {
    paymentsService.listAdminSubscriptions.mockResolvedValue({ total: 1, items: [{ id: 'sub_1' }] });

    const output = await service.listSubscriptions({ status: SubscriptionStatus.active, market: 'BR', page: 1, perPage: 20 });

    expect(paymentsService.listAdminSubscriptions).toHaveBeenCalledWith({
      status: SubscriptionStatus.active,
      market: 'BR',
      page: 1,
      perPage: 20,
    });
    expect(output).toEqual({ total: 1, items: [{ id: 'sub_1' }] });
  });
});
