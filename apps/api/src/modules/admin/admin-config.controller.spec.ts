import { AdminConfigController } from './admin-config.controller';
import { AdminConfigService } from './admin-config.service';

describe('AdminConfigController', () => {
  let service: {
    listBusinessRules: jest.Mock;
    updateBusinessRule: jest.Mock;
  };
  let controller: AdminConfigController;

  beforeEach(() => {
    service = {
      listBusinessRules: jest.fn(),
      updateBusinessRule: jest.fn(),
    };
    controller = new AdminConfigController(service as unknown as AdminConfigService);
  });

  it('listBusinessRules should delegate to service', async () => {
    service.listBusinessRules.mockResolvedValue({ total: 1 });

    const output = await controller.listBusinessRules({ page: 1, perPage: 20 });

    expect(service.listBusinessRules).toHaveBeenCalledWith({ page: 1, perPage: 20 });
    expect(output).toEqual({ total: 1 });
  });

  it('updateBusinessRule should delegate to service', async () => {
    service.updateBusinessRule.mockResolvedValue({ id: 'rule_1' });

    const output = await controller.updateBusinessRule('rule_1', { active: false });

    expect(service.updateBusinessRule).toHaveBeenCalledWith('rule_1', { active: false });
    expect(output).toEqual({ id: 'rule_1' });
  });
});
