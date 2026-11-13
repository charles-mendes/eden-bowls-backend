const { PlanSettingsService } = require('../src/services/plan-settings.service');

function setup(stored = { market: 'BR', planDays: 30, largePackLimit: 8, stored: true, updatedAt: null }) {
  let current = { ...stored };
  const repository = {
    read: jest.fn(async (market) => ({ ...current, market })),
    save: jest.fn(async (market, values) => {
      current = { ...current, ...values, stored: true };
    })
  };
  const auditRepository = { createIn: jest.fn() };
  const manager = { name: 'manager' };
  const dataSource = { transaction: jest.fn(async (work) => work(manager)) };
  const service = new PlanSettingsService({ repository, auditRepository, dataSource });
  return { service, repository, auditRepository, manager };
}

describe('PlanSettingsService', () => {
  test('reads one market', async () => {
    const { service } = setup();
    expect(await service.read('br')).toEqual({ market: 'BR', planDays: 30, largePackLimit: 8, updatedAt: null });
  });

  test('a missing or unknown market answers 400', async () => {
    const { service } = setup();
    await expect(service.read('')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.update('AR', { planDays: 30, largePackLimit: 8 })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('saves valid values and records what changed', async () => {
    const { service, repository, auditRepository, manager } = setup();

    const saved = await service.update('BR', { planDays: 28, largePackLimit: '6' }, { userId: 7, email: 'op@eden.test' });

    expect(repository.save).toHaveBeenCalledWith('BR', { planDays: 28, largePackLimit: 6 }, 7, manager);
    expect(auditRepository.createIn).toHaveBeenCalledWith(manager, {
      actorUserId: 7,
      actorEmail: 'op@eden.test',
      action: 'catalog.plan_settings.update',
      metadata: { market: 'BR', changes: { planDays: { from: 30, to: 28 }, largePackLimit: { from: 8, to: 6 } } }
    });
    expect(saved).toMatchObject({ planDays: 28, largePackLimit: 6 });
  });

  test('an unchanged save writes nothing', async () => {
    const { service, repository, auditRepository } = setup();
    await service.update('BR', { planDays: 30, largePackLimit: 8 });
    expect(repository.save).not.toHaveBeenCalled();
    expect(auditRepository.createIn).not.toHaveBeenCalled();
  });

  test.each([[0], [-1], [28.5], ['abc'], [null], [true]])('plan days %p is refused', async (planDays) => {
    const { service, repository } = setup();
    await expect(service.update('BR', { planDays, largePackLimit: 8 })).rejects.toMatchObject({
      statusCode: 422, details: { code: 'plan_days_invalid' }
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  test.each([[0], [61], [6.5], [null]])('large-pack limit %p is refused', async (largePackLimit) => {
    const { service, repository } = setup();
    await expect(service.update('US', { planDays: 30, largePackLimit })).rejects.toMatchObject({
      statusCode: 422, details: { code: 'large_pack_limit_invalid' }
    });
    expect(repository.save).not.toHaveBeenCalled();
  });
});
