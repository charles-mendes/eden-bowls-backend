const { parseOnboardingSubscriptionCheckoutInput } = require('../src/api/validators/onboarding-subscription-checkout.validator');
const { parseFiscalName } = require('../src/core/tax-document');

describe('parseOnboardingSubscriptionCheckoutInput', () => {
  const payload = {
    payment_method_id: 'pm_123',
    legal_consent: { accepted: true },
    renewal_consent: { accepted: true, version: '2026-11-10' },
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

  test('returns the accepted renewal consent with its version', () => {
    expect(parseOnboardingSubscriptionCheckoutInput(payload).renewal_consent).toEqual({ accepted: true, version: '2026-11-10' });
    expect(parseOnboardingSubscriptionCheckoutInput({ ...payload, renewal_consent: { accepted: true } }).renewal_consent).toEqual({ accepted: true, version: undefined });
  });

  test.each([
    ['Renewal box not ticked', { accepted: false }],
    ['Old client without the field', undefined],
    ['accepted as a string', { accepted: 'true' }],
    ['a version longer than 32 characters', { accepted: true, version: 'x'.repeat(33) }]
  ])('%s: 422 renewal_consent_required', (_name, renewal) => {
    expect(() => parseOnboardingSubscriptionCheckoutInput({ ...payload, renewal_consent: renewal })).toThrow(expect.objectContaining({
      statusCode: 422,
      message: 'Accepting the automatic renewal is required.',
      details: expect.objectContaining({ code: 'renewal_consent_required' })
    }));
  });

  test.each([
    ['Both boxes missing', {}],
    ['terms not ticked and a renewal version too long', { renewal_consent: { accepted: true, version: 'x'.repeat(33) } }]
  ])('%s: 422 legal_consent_required first', (_name, extra) => {
    const { legal_consent: _legal, renewal_consent: _renewal, ...bare } = payload;
    expect(() => parseOnboardingSubscriptionCheckoutInput({ ...bare, ...extra })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ code: 'legal_consent_required' })
    }));
  });
});
