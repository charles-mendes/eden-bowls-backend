const {
  parseSubscriptionsEditCommitInput,
  parseSubscriptionsEditPreviewInput
} = require('../src/api/validators/subscriptions-edit.validator');

const base = {
  subscription_term_months: 1,
  pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
  expected_current_hash: 'hash'
};

describe('subscriptions edit address recipient', () => {
  test('an omitted recipient stays omitted, so the commit keeps the stored one', () => {
    const parsed = parseSubscriptionsEditCommitInput({ ...base, address: { country: 'BR', street: 'Rua A' } });
    expect(parsed.address).not.toHaveProperty('recipient_name');
  });

  test('a sent recipient is normalized', () => {
    const parsed = parseSubscriptionsEditPreviewInput({ ...base, address: { country: 'BR', recipient_name: '  João   Lima ' } });
    expect(parsed.address.recipient_name).toBe('João Lima');
  });

  test.each([[''], ['a@b'], ['12']])('refuses %p in preview and commit', (recipient) => {
    const payload = { ...base, address: { country: 'BR', recipient_name: recipient } };
    const expected = expect.objectContaining({ statusCode: 422, details: expect.objectContaining({ field: 'recipient_name' }) });
    expect(() => parseSubscriptionsEditPreviewInput(payload)).toThrow(expected);
    expect(() => parseSubscriptionsEditCommitInput(payload)).toThrow(expected);
  });
});
