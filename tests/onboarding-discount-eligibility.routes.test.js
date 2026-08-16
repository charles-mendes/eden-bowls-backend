const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function issueAccessToken(userId) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

describe('onboarding discount eligibility routes', () => {
  test('returns eligibility for the authenticated user', async () => {
    const onboardingDiscountEligibilityService = {
      getEligibility: jest.fn().mockResolvedValue({ success: true, data: { validated: true, eligible: true, reason: null } })
    };
    const app = createApp({ onboardingDiscountEligibilityService, corsOrigins, jwt });

    const response = await request(app)
      .get('/api/v1/onboarding/discount/eligibility')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { validated: true, eligible: true, reason: null } });
    expect(onboardingDiscountEligibilityService.getEligibility).toHaveBeenCalledWith({ userId: 7, market: MARKETS.US });
  });

  test('returns eligibility without bearer authentication', async () => {
    const onboardingDiscountEligibilityService = {
      getEligibility: jest.fn().mockResolvedValue({
        success: true,
        data: { validated: false, eligible: null, reason: 'NOT_AUTHENTICATED' }
      })
    };
    const app = createApp({ onboardingDiscountEligibilityService, corsOrigins, jwt });

    const response = await request(app).get('/api/v1/onboarding/discount/eligibility');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { validated: false, eligible: null, reason: 'NOT_AUTHENTICATED' }
    });
    expect(onboardingDiscountEligibilityService.getEligibility).toHaveBeenCalledWith({ userId: null, market: MARKETS.US });
  });
});
