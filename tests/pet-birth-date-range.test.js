const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');
const { parseOnboardingPetCreateInput } = require('../src/api/validators/onboarding-pets-create.validator');
const { parseOnboardingPetsSyncInput } = require('../src/api/validators/onboarding-pets-sync.validator');
const { parseOnboardingPetUpdateInput } = require('../src/api/validators/onboarding-pets-update.validator');

const NOW = new Date('2026-10-19T12:00:00Z');

const parsers = {
  create: (birthDate, market) => parseOnboardingPetCreateInput({ name: 'Luna', birth_date: birthDate }, market, NOW),
  sync: (birthDate, market) => parseOnboardingPetsSyncInput({ pets: [{ local_id: 'l-1', name: 'Luna', birth_date: birthDate }] }, market, NOW),
  update: (birthDate, market) => parseOnboardingPetUpdateInput({ birth_date: birthDate, change_source: 'dashboard' }, market, NOW)
};

describe.each(Object.entries(parsers))('birth date range on %s', (_name, parse) => {
  test('a future date is refused in the market language', () => {
    expect(() => parse('2026-10-20', MARKETS.BR)).toThrow(expect.objectContaining({
      statusCode: 422,
      message: 'A data de nascimento não pode estar no futuro.',
      details: { code: 'birth_date_out_of_range', reason: 'future' }
    }));
    expect(() => parse('2026-10-20', MARKETS.US)).toThrow('The birth date cannot be in the future.');
  });

  test('a date more than 30 years ago is refused', () => {
    expect(() => parse('1996-10-18', MARKETS.BR)).toThrow('A data de nascimento não pode ser de mais de 30 anos atrás.');
    expect(() => parse('1996-10-18', MARKETS.US)).toThrow(expect.objectContaining({
      message: 'The birth date cannot be more than 30 years ago.',
      details: { code: 'birth_date_out_of_range', reason: 'too_old' }
    }));
  });

  test('today and exactly 30 years ago are accepted', () => {
    expect(() => parse('2026-10-19', MARKETS.BR)).not.toThrow();
    expect(() => parse('1996-10-19', MARKETS.US)).not.toThrow();
  });
});

describe('POST /api/v1/onboarding/pets with an out-of-range birth date', () => {
  test('returns 422 with the Portuguese message for Brazil and creates nothing', async () => {
    const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
    const onboardingPetCreateService = { createPet: jest.fn() };
    const app = createApp({ onboardingPetCreateService, corsOrigins: ['http://localhost:5173'], jwt });
    const token = issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });

    const response = await request(app)
      .post('/api/v1/onboarding/pets?country=BR')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Luna', birth_date: '2999-01-01', change_source: 'dashboard' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, message: 'A data de nascimento não pode estar no futuro.' });
    expect(onboardingPetCreateService.createPet).not.toHaveBeenCalled();
  });
});
