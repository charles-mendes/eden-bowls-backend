const { firstNameFrom } = require('../src/core/email/mail-context');

describe('firstNameFrom', () => {
  test('never greets the delivery recipient', () => {
    expect(firstNameFrom({ address: { recipient_name: 'João Lima' } })).toBe('');
    expect(firstNameFrom({ address: { recipient_name: 'João Lima' }, customerName: 'Ana Costa' })).toBe('Ana');
  });
});
