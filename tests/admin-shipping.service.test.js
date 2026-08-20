const { AdminShippingService } = require('../src/services/admin-shipping.service');

describe('AdminShippingService', () => {
  test('loads settings from the repository and refreshes the shipping service cache', async () => {
    const settings = { br: { enabled: true, rule: { per_km: 0.95 } }, us: { cost: 12.9 } };
    const repository = {
      get: jest.fn().mockResolvedValue(settings)
    };
    const shippingService = { settings: null };
    const service = new AdminShippingService({ repository, shippingService });

    const result = await service.getSettings();

    expect(result.data.settings.us.cost).toBe(12.9);
    expect(shippingService.settings).toBe(settings);
    expect(result.data.envOverrides).toBeUndefined();
  });

  test('persists settings in the repository when saving', async () => {
    const saved = { br: { enabled: false }, us: { cost: 14 } };
    const repository = {
      save: jest.fn().mockResolvedValue(saved)
    };
    const shippingService = { settings: { us: { cost: 12.9 } } };
    const service = new AdminShippingService({ repository, shippingService });

    const result = await service.saveSettings({ br: { enabled: false } });

    expect(repository.save).toHaveBeenCalledWith({ br: { enabled: false } });
    expect(result.data.settings).toEqual(saved);
    expect(shippingService.settings).toEqual(saved);
  });

  test('throws 503 when the repository is missing', async () => {
    const service = new AdminShippingService({});

    await expect(service.getSettings()).rejects.toMatchObject({
      statusCode: 503,
      message: 'Shipping settings repository is not available.'
    });
  });
});
