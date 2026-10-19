const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');
const { HttpError } = require('../src/core/http-error');
const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { allowedLifeStages, isOutsideAllowed, planLinesForPet } = require('../src/core/life-stage-lines');
const { LifeStageService } = require('../src/services/life-stage.service');
const { OnboardingPetUpdateService } = require('../src/services/onboarding-pets-update.service');

const NOW = new Date('2026-11-02T15:00:00Z');

function lifeStageService() {
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  return new LifeStageService({ repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) }, now: () => NOW });
}

function medium(years, months = 0) {
  return { id: 'pet-1', name: 'Thor', size: 'medium', age_years: years, age_months: months, age_recorded_at: NOW.toISOString(), birth_date: null };
}

function plan(flavors) {
  return { catalog_pricing: { line_items: flavors.map((flavor) => ({ pet_id: 'pet-1', flavor, quantity: 2 })) } };
}

function serviceFor({ current, publishedLines = ['adult', 'puppy', 'senior'], subscriptions }) {
  const repository = {
    findPet: jest.fn().mockResolvedValue(current),
    updatePet: jest.fn(async (_userId, _petId, update) => ({ ...current, ...update }))
  };
  const noticesRepository = { upsertNotified: jest.fn() };
  const ageChangesRepository = { record: jest.fn() };
  const service = new OnboardingPetUpdateService(repository, {
    lifeStageService: lifeStageService(),
    ageChangesRepository,
    noticesRepository,
    ledgerRepository: {
      listByUserId: jest.fn().mockResolvedValue(subscriptions || [
        { id: 11, stripeSubscriptionId: 'sub_1', stripeAccount: 'br', status: 'active', planSelection: plan(['beef', 'pork']) }
      ])
    },
    recipeLinesRepository: {
      listRecipeLines: jest.fn().mockResolvedValue({
        BR: {
          lineByKey: { beef: 'adult', pork: 'adult', 'senior-beef': 'senior', 'puppy-chicken-pork': 'puppy' },
          publishedLines: new Set(publishedLines)
        }
      })
    },
    now: () => NOW
  });
  return { service, repository, noticesRepository, ageChangesRepository };
}

const BR = MARKETS.BR;

describe('allowed lines (design decision 4)', () => {
  test('segregated lines, with adult when the stage has no published recipe', () => {
    expect(allowedLifeStages('senior', new Set(['adult', 'senior']))).toEqual(['senior']);
    expect(allowedLifeStages('puppy', new Set(['adult', 'senior']))).toEqual(['adult']);
    expect(allowedLifeStages(null, new Set(['adult']))).toEqual(['adult']);
  });

  test('plan lines of one pet, adult for recipes without a stored line', () => {
    const selection = { catalog_pricing: { line_items: [
      { pet_id: 'pet-1', flavor: 'senior-beef', quantity: 2 },
      { pet_id: 'pet-2', flavor: 'beef', quantity: 1 },
      { pet_id: 'pet-1', flavor: 'mystery', quantity: 1 }
    ] } };
    expect(planLinesForPet(selection, 'pet-1', { 'senior-beef': 'senior' })).toEqual(['senior', 'adult']);
    expect(isOutsideAllowed(['senior', 'adult'], ['senior'])).toBe(true);
    expect(planLinesForPet({ pets: [{ pet_id: 'pet-1', selected_flavors: ['beef'] }] }, 'pet-1', {})).toEqual(['adult']);
  });
});

describe('PATCH confirmation when a plan leaves the pet line (L-21)', () => {
  test('adult corrected to senior without confirming: 409 with the new stage and the plan, nothing saved', async () => {
    const { service, repository, noticesRepository, ageChangesRepository } = serviceFor({ current: medium(7) });

    await expect(service.updatePet({ userId: 7, petId: 'pet-1', payload: { age_years: 8 }, market: BR })).rejects.toMatchObject({
      statusCode: 409,
      details: {
        code: 'life_stage_change_requires_confirmation',
        life_stage: 'senior',
        affected_subscriptions: [{ subscription_id: 'sub_1', market: 'BR', plan_line: 'adult', life_stage: 'senior', allowed_life_stages: ['senior'] }]
      }
    });
    expect(repository.updatePet).not.toHaveBeenCalled();
    expect(noticesRepository.upsertNotified).not.toHaveBeenCalled();
    expect(ageChangesRepository.record).not.toHaveBeenCalled();
  });

  test('confirmed: saves and marks the transition notified by manual correction', async () => {
    const { service, repository, noticesRepository } = serviceFor({ current: medium(7) });

    await service.updatePet({ userId: 7, petId: 'pet-1', payload: { age_years: 8, confirm_life_stage_change: true }, market: BR });

    expect(repository.updatePet).toHaveBeenCalledWith(7, 'pet-1', { age_years: 8, age_recorded_at: NOW });
    expect(noticesRepository.upsertNotified).toHaveBeenCalledWith({
      subscriptionId: 11, petId: 'pet-1', fromLine: 'adult', toLine: 'senior', via: 'manual_correction', at: NOW
    });
  });

  test('adult corrected to puppy also needs confirmation', async () => {
    const { service } = serviceFor({ current: medium(2) });

    await expect(service.updatePet({ userId: 7, petId: 'pet-1', payload: { age_years: 0, age_months: 6 }, market: BR }))
      .rejects.toMatchObject({ statusCode: 409, details: { life_stage: 'puppy' } });
  });

  test('a change inside the same line saves directly', async () => {
    const { service, repository, noticesRepository } = serviceFor({ current: medium(3) });

    await service.updatePet({ userId: 7, petId: 'pet-1', payload: { age_years: 4 }, market: BR });

    expect(repository.updatePet).toHaveBeenCalled();
    expect(noticesRepository.upsertNotified).not.toHaveBeenCalled();
  });

  test('no confirmation while the new line has no published recipe', async () => {
    const { service, repository } = serviceFor({ current: medium(7), publishedLines: ['adult'] });

    await service.updatePet({ userId: 7, petId: 'pet-1', payload: { age_years: 8 }, market: BR });

    expect(repository.updatePet).toHaveBeenCalled();
  });

  test('a plan already outside the line before the change asks nothing', async () => {
    const { service, repository } = serviceFor({ current: medium(9) });

    await service.updatePet({ userId: 7, petId: 'pet-1', payload: { age_years: 10 }, market: BR });

    expect(repository.updatePet).toHaveBeenCalled();
  });

  test('cancelled plans and plans without this pet are ignored', async () => {
    const { service, repository } = serviceFor({
      current: medium(7),
      subscriptions: [
        { id: 12, stripeSubscriptionId: 'sub_2', stripeAccount: 'br', status: 'canceled', planSelection: plan(['beef']) },
        { id: 13, stripeSubscriptionId: 'sub_3', stripeAccount: 'br', status: 'active', planSelection: { catalog_pricing: { line_items: [{ pet_id: 'pet-9', flavor: 'beef', quantity: 1 }] } } }
      ]
    });

    await service.updatePet({ userId: 7, petId: 'pet-1', payload: { age_years: 8 }, market: BR });

    expect(repository.updatePet).toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/onboarding/pets/:petId confirmation body', () => {
  const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

  test('returns the 409 details and passes the confirmation flag through', async () => {
    const details = { code: 'life_stage_change_requires_confirmation', life_stage: 'senior', affected_subscriptions: [{ subscription_id: 'sub_1' }] };
    const onboardingPetUpdateService = {
      updatePet: jest.fn()
        .mockRejectedValueOnce(new HttpError(409, 'Confirm to save.', details))
        .mockResolvedValueOnce({ success: true, data: { pet: { id: 'pet-1' } } })
    };
    const app = createApp({ onboardingPetUpdateService, corsOrigins: ['http://localhost:5173'], jwt });
    const auth = `Bearer ${issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) })}`;

    const refused = await request(app).patch('/api/v1/onboarding/pets/pet-1').set('Authorization', auth).send({ age_years: 8 });
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ success: false, message: 'Confirm to save.', details });

    const confirmed = await request(app).patch('/api/v1/onboarding/pets/pet-1').set('Authorization', auth)
      .send({ age_years: 8, confirm_life_stage_change: true, change_source: 'dashboard' });
    expect(confirmed.status).toBe(200);
    expect(onboardingPetUpdateService.updatePet.mock.calls[1][0].payload).toMatchObject({ age_years: 8, confirm_life_stage_change: true, change_source: 'dashboard' });
  });
});
