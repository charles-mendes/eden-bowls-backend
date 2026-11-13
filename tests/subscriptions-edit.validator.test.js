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

  test('keeps the CPF and the fiscal name for the edit to check', () => {
    const parsed = parseSubscriptionsEditPreviewInput({ ...base, tax_document: ' 529.982.247-25 ', fiscal_name: 'Maria Souza' });
    expect(parsed).toMatchObject({ tax_document: '529.982.247-25', fiscal_name: 'Maria Souza' });
  });
});

describe('subscriptions edit delivery instructions', () => {
  test('omitted stays omitted, so the commit keeps the stored text', () => {
    const parsed = parseSubscriptionsEditCommitInput({ ...base, address: { country: 'BR', street: 'Rua A' } });
    expect(parsed.address).not.toHaveProperty('delivery_instructions');
  });

  test('a sent text is normalized and an empty string clears', () => {
    const sent = parseSubscriptionsEditPreviewInput({ ...base, address: { country: 'BR', delivery_instructions: ' Portão\n azul ' } });
    expect(sent.address.delivery_instructions).toBe('Portão azul');
    const cleared = parseSubscriptionsEditCommitInput({ ...base, address: { country: 'BR', delivery_instructions: '' } });
    expect(cleared.address.delivery_instructions).toBe('');
  });

  test('too long on the subscription edit: 422 with the field, not invalid_plan', () => {
    const payload = { ...base, address: { country: 'BR', delivery_instructions: 'a'.repeat(201) } };
    const expected = expect.objectContaining({
      statusCode: 422,
      details: expect.objectContaining({ code: 'invalid_delivery_instructions', field: 'delivery_instructions' })
    });
    expect(() => parseSubscriptionsEditPreviewInput(payload)).toThrow(expected);
    expect(() => parseSubscriptionsEditCommitInput(payload)).toThrow(expected);
  });
});
