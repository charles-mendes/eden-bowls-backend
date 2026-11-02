const { parseOnboardingSubscriptionCheckoutInput } = require('../src/api/validators/onboarding-subscription-checkout.validator');
const { parseFiscalName } = require('../src/core/tax-document');

describe('parseOnboardingSubscriptionCheckoutInput', () => {
  const payload = {
    payment_method_id: 'pm_123',
    legal_consent: { accepted: true },
    tax_document: '52998224725'
  };

  test('hands the fiscal name to the checkout, valid for the NF-e', () => {
    const parsed = parseOnboardingSubscriptionCheckoutInput({
      ...payload,
      fiscal_name: 'Charles Juan da Silva Mendes'
    });

    expect(parsed.fiscal_name).toBe('Charles Juan da Silva Mendes');
    expect(parseFiscalName(parsed.fiscal_name)).toBe('Charles Juan da Silva Mendes');
  });

  test('leaves the fiscal name undefined when the checkout has none', () => {
    expect(parseOnboardingSubscriptionCheckoutInput(payload).fiscal_name).toBeUndefined();
  });
});
