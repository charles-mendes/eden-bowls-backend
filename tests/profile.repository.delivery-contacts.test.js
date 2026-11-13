const { ProfileRepository } = require('../src/infrastructure/repositories/profile.repository');

describe('ProfileRepository.listDeliveryContacts', () => {
  test('reads phones and profile instructions of all users in two queries', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn(async (sql) => (sql.includes('billing_phone')
        ? [{ user_id: 10, meta_value: ' +55 11 98888-7777 ' }, { user_id: 11, meta_value: '' }]
        : [{ user_id: 10, address: JSON.stringify({ delivery_instructions: 'Interfone 12', country: 'BR', zipcode: '05435000', street: 'Rua Harmonia', number: '45', city: 'São Paulo' }) }, { user_id: 12, address: '{}' }]))
    };

    const contacts = await new ProfileRepository(dataSource).listDeliveryContacts(['10', 11, '10', 'x']);

    expect(dataSource.query).toHaveBeenCalledTimes(2);
    expect(dataSource.query.mock.calls[0][1]).toEqual([10, 11]);
    // Only the place goes with the instructions, for the same-place rule (delivery-instructions).
    expect(contacts.get('10')).toEqual({
      phone: '+55 11 98888-7777',
      deliveryInstructions: 'Interfone 12',
      profileAddress: { country: 'BR', zipcode: '05435000', street: 'Rua Harmonia', number: '45' }
    });
    expect(contacts.has('11')).toBe(false);
    expect(contacts.has('12')).toBe(false);
  });

  test('asks nothing without users', async () => {
    const dataSource = { isInitialized: true, query: jest.fn() };
    expect((await new ProfileRepository(dataSource).listDeliveryContacts([])).size).toBe(0);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
