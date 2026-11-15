const { NutritionParametersService } = require('../src/services/nutrition-parameters.service');
const { parseNutritionParameters } = require('../src/core/nutrition-parameters');
const { DEFAULT_NUTRITION_PARAMETERS } = require('../src/core/nutrition-recommendation');

const defaults = () => JSON.parse(JSON.stringify(DEFAULT_NUTRITION_PARAMETERS));

function setup({ draft = null, published = { id: 1, parameters: defaults(), publishedAt: null } } = {}) {
  const repository = {
    published: jest.fn().mockResolvedValue(published),
    draft: jest.fn().mockResolvedValue(draft),
    history: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    saveDraft: jest.fn(async ({ parameters }) => ({ id: 2, status: 'draft', parameters })),
    deleteDraft: jest.fn(),
    publishDraft: jest.fn().mockResolvedValue(undefined),
    clearCache: jest.fn()
  };
  const manager = { query: jest.fn() };
  const dataSource = { transaction: jest.fn(async (work) => work(manager)) };
  const auditRepository = {
    createIn: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(undefined),
    listByActionPrefix: jest.fn().mockResolvedValue([{ id: 3, action: 'nutrition.parameters.publish', actorEmail: 'vet@edenbowls.com' }])
  };
  return { service: new NutritionParametersService({ repository, auditRepository, dataSource }), repository, auditRepository, manager };
}

describe('parseNutritionParameters', () => {
  test('accepts the values of the code as they are', () => {
    expect(parseNutritionParameters(defaults())).toEqual(defaults());
  });

  test('Breed in two groups: 422 naming the breed', () => {
    const input = defaults();
    input.breed_groups.dogue.push('Saint Bernard');

    expect(() => parseNutritionParameters(input)).toThrow(expect.objectContaining({
      statusCode: 422,
      details: expect.objectContaining({ code: 'nutrition_parameters_invalid', fields: ['breed_groups.slow_metabolism:saint bernard'] })
    }));
  });

  test('refuses a factor outside 1 to 400, a NEM outside 500 to 8000 and a missing key', () => {
    const input = defaults();
    input.combination_giant['NAO-ALTO-ABAIXO'] = 401;
    input.combination['SIM-BAIXO-ACIMA'] = 0;
    input.nem.cat = 499;
    delete input.state.SENIOR;

    let error;
    try { parseNutritionParameters(input); } catch (caught) { error = caught; }

    expect(error.details.fields).toEqual(['combination.SIM-BAIXO-ACIMA', 'combination_giant.NAO-ALTO-ABAIXO', 'state.SENIOR', 'nem.cat']);
  });

  test('copying a set saved before the document brings the giant matrix and the cat factors', async () => {
    const { service, repository } = setup();
    const legacy = defaults();
    delete legacy.combination_giant;
    legacy.base = { dog: 95, cat: 242, cat_overweight: 134 };
    repository.findById.mockResolvedValue({ id: 1, status: 'retired', parameters: legacy });

    const draft = await service.copyToDraft(1, { userId: 7 });

    expect(draft.parameters.base).toEqual({ cat: 60, cat_active: 100 });
    expect(draft.parameters.combination_giant['NAO-ALTO-ABAIXO']).toBe(115);
  });

  test('accepts a fresh-food EM such as 957 kcal/kg', () => {
    const input = defaults();
    input.nem.cat = 957;
    expect(parseNutritionParameters(input).nem.cat).toBe(957);
  });

  test('normalizes breeds and drops repeats within a group', () => {
    const input = defaults();
    input.breed_groups.terranova = [' Térra  Nova', 'terra nova', 'Newfoundland'];

    expect(parseNutritionParameters(input).breed_groups.terranova).toEqual(['terra nova', 'newfoundland']);
  });
});

describe('NutritionParametersService', () => {
  test('saves a valid draft', async () => {
    const { service, repository } = setup();
    const input = defaults();
    input.base.cat = 70;

    const draft = await service.saveDraft(input, { userId: 7 });

    expect(draft.parameters.base.cat).toBe(70);
    expect(repository.saveDraft).toHaveBeenCalledWith({ parameters: expect.objectContaining({ base: expect.objectContaining({ cat: 70 }) }), actorId: 7 });
  });

  test('records who saved the draft and which factors changed', async () => {
    const { service, auditRepository } = setup();
    const input = defaults();
    input.base.cat = 70;
    const before = defaults().base.cat;

    await service.saveDraft(input, { userId: 7, email: 'vet@edenbowls.com' });

    expect(auditRepository.create).toHaveBeenCalledWith({
      actorUserId: 7,
      actorEmail: 'vet@edenbowls.com',
      action: 'nutrition.parameters.draft.save',
      metadata: { set_id: 2, changes: [{ field: 'base.cat', from: before, to: 70 }] }
    });
  });

  test('records the discard only when there was a draft', async () => {
    const withDraft = setup({ draft: { id: 4, status: 'draft', parameters: defaults() } });
    await withDraft.service.discardDraft({ userId: 7, email: 'vet@edenbowls.com' });
    expect(withDraft.auditRepository.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'nutrition.parameters.draft.discard', metadata: { set_id: 4 } }));

    const without = setup();
    await without.service.discardDraft({ userId: 7 });
    expect(without.auditRepository.create).not.toHaveBeenCalled();
  });

  test('the overview carries the edit history of the parameter sets', async () => {
    const { service, auditRepository } = setup();
    const overview = await service.overview();
    expect(auditRepository.listByActionPrefix).toHaveBeenCalledWith({ actionPrefix: 'nutrition.parameters.', limit: 50 });
    expect(overview.audit).toEqual([expect.objectContaining({ action: 'nutrition.parameters.publish', actorEmail: 'vet@edenbowls.com' })]);
  });

  test('publishing retires the previous set with the audit event in one transaction', async () => {
    const { service, repository, auditRepository, manager } = setup({ draft: { id: 2, status: 'draft', parameters: defaults() } });

    await service.publish({ userId: 7, email: 'vet@edenbowls.com' });

    expect(repository.publishDraft).toHaveBeenCalledWith({ draftId: 2, actorId: 7 }, manager);
    expect(auditRepository.createIn).toHaveBeenCalledWith(manager, {
      actorUserId: 7, actorEmail: 'vet@edenbowls.com', action: 'nutrition.parameters.publish', metadata: { from_set_id: 1, to_set_id: 2, changes: expect.any(Array) }
    });
    expect(repository.clearCache).toHaveBeenCalled();
  });

  test('publishing without a draft answers 409', async () => {
    const { service, repository } = setup();
    await expect(service.publish({ userId: 7 })).rejects.toMatchObject({ statusCode: 409, details: { code: 'nutrition_draft_missing' } });
    expect(repository.publishDraft).not.toHaveBeenCalled();
  });

  test('copies a retired set into the draft', async () => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValue({ id: 1, status: 'retired', parameters: defaults() });

    await service.copyToDraft(1, { userId: 7 });

    expect(repository.saveDraft).toHaveBeenCalledWith({ parameters: defaults(), actorId: 7 });
  });

  test('simulating with no draft answers 409', async () => {
    const { service } = setup();
    await expect(service.parametersFor('draft')).rejects.toMatchObject({ statusCode: 409 });
  });
});
