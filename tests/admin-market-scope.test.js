const { HttpError } = require('../src/core/http-error');
const {
  canAccessMarket,
  constrainMarketQuery,
  assertRecordMarket,
  effectiveMarkets,
  parseMarkets,
  resolveStaffMarkets,
  marketPermissions,
  stripeAccountForMarkets
} = require('../src/core/admin-market-scope');

function operator(markets = ['BR']) {
  return {
    userId: '7',
    roles: ['operator'],
    markets,
    permissions: ['users.read', ...marketPermissions(markets)]
  };
}

describe('admin market scope helper', () => {
  test('parses stored usermeta markets', () => {
    expect(parseMarkets('["BR"]')).toEqual(['BR']);
    expect(parseMarkets('us')).toEqual(['US']);
    expect(parseMarkets('["US","BR","US"]')).toEqual(['BR', 'US']);
  });

  test('admins always resolve to both markets', () => {
    expect(resolveStaffMarkets({ roles: ['admin'], storedMarkets: '' })).toEqual(['BR', 'US']);
    expect(marketPermissions(['BR', 'US'])).toEqual(['market.br', 'market.us']);
  });

  test('maps markets onto stripe accounts', () => {
    expect(stripeAccountForMarkets(['BR'])).toEqual(['br']);
    expect(stripeAccountForMarkets(['US', 'BR'])).toEqual(['br', 'us']);
  });

  test('flag off leaves unassigned non-admin unscoped', () => {
    expect(effectiveMarkets(operator([]), { ADMIN_ENFORCE_STAFF_MARKET: 'false' })).toEqual(['BR', 'US']);
    expect(constrainMarketQuery(operator(['BR']), {}, { ADMIN_ENFORCE_STAFF_MARKET: '' }).markets).toEqual(['BR']);
  });

  test('flag off still scopes assigned staff', () => {
    const scoped = constrainMarketQuery(operator(['BR']), {}, { ADMIN_ENFORCE_STAFF_MARKET: '0' });
    expect(scoped.markets).toEqual(['BR']);
    expect(scoped.stripeAccounts).toEqual(['br']);
    expect(scoped.filtered).toBe(false);
  });

  test('marks a requested in-scope filter as filtered', () => {
    const scoped = constrainMarketQuery(operator(['BR', 'US']), { market: 'BR' });
    expect(scoped.markets).toEqual(['BR']);
    expect(scoped.filtered).toBe(true);
  });

  test('flag on returns market_required for unassigned non-admin on query', () => {
    try {
      constrainMarketQuery(operator([]), {}, { ADMIN_ENFORCE_STAFF_MARKET: 'true' });
      throw new Error('expected market_required');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error.statusCode).toBe(403);
      expect(error.details).toEqual({ code: 'market_required' });
    }
  });

  test('flag on returns market_required for unassigned non-admin on record', () => {
    try {
      assertRecordMarket(operator([]), 'BR', { ADMIN_ENFORCE_STAFF_MARKET: '1' });
      throw new Error('expected market_required');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error.statusCode).toBe(403);
      expect(error.details).toEqual({ code: 'market_required' });
    }
  });

  test('out-of-scope query filter is market_forbidden', () => {
    try {
      constrainMarketQuery(operator(['BR']), { market: 'US' });
      throw new Error('expected market_forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error.statusCode).toBe(403);
      expect(error.details).toEqual({ code: 'market_forbidden' });
    }
  });

  test('out-of-scope stripe account is market_forbidden', () => {
    try {
      constrainMarketQuery(operator(['BR']), { account: 'us' });
      throw new Error('expected market_forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error.statusCode).toBe(403);
      expect(error.details).toEqual({ code: 'market_forbidden' });
    }
  });

  test('admin may filter one market', () => {
    const scoped = constrainMarketQuery(
      { roles: ['admin'], markets: ['BR', 'US'] },
      { account: 'us' }
    );
    expect(scoped.markets).toEqual(['US']);
    expect(scoped.stripeAccount).toBe('us');
  });

  test('record outside scope is 404', () => {
    try {
      assertRecordMarket(operator(['BR']), 'US');
      throw new Error('expected 404');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error.statusCode).toBe(404);
    }
  });

  test('customers without a profile market are admin-only', () => {
    expect(canAccessMarket({ roles: ['admin'], markets: ['BR', 'US'] }, '')).toBe(true);
    expect(canAccessMarket(operator(['BR']), '')).toBe(false);
    expect(canAccessMarket(operator(['BR']), 'BR')).toBe(true);
  });
});
