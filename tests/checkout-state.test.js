const { HttpError } = require('../src/core/http-error');
const { validateCheckoutState } = require('../src/core/checkout-state');

const completeContext = {
  pets: [{ id: 'pet-1' }],
  planSelection: {
    catalog_pricing: {
      subtotal: 40,
      line_items: [{ stripe_price_id: 'price_abc', quantity: 1 }]
    }
  },
  address: { country: 'BR', zipcode: '83331160', state: 'PR', city: 'Pinhais' },
  shipping: { rate_id: 'distance_km:br-default' },
  recurrence: { frequency: 'monthly' }
};

describe('validateCheckoutState', () => {
  test('accepts pets from plan_selection when onboarding_pets is empty', () => {
    expect(() => validateCheckoutState({
      ...completeContext,
      pets: [],
      planSelection: {
        ...completeContext.planSelection,
        pets: [{
          pet_id: '526fb705-9da4-4d27-965e-da39a20d3b12',
          pet_name: 'luna',
          enabled: true
        }]
      }
    })).not.toThrow();
  });

  test('still requires pets when plan_selection has none', () => {
    try {
      validateCheckoutState({
        ...completeContext,
        pets: [],
        planSelection: completeContext.planSelection
      });
      throw new Error('expected session_incomplete');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error.statusCode).toBe(422);
      expect(error.details.code).toBe('session_incomplete');
      expect(error.details.missing).toEqual(['pets']);
    }
  });
});
