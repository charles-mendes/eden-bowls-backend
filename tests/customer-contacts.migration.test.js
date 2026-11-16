const { CreateCustomerContacts1700000000065 } = require('../src/infrastructure/migrations/1700000000065-create-customer-contacts');

function runner(exists) {
  return { query: jest.fn(async (sql) => (sql.includes('information_schema') ? (exists ? [{ 1: 1 }] : []) : [])) };
}

const writes = (queryRunner) => queryRunner.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim()).filter((sql) => /^(CREATE|DROP)/.test(sql));

describe('CreateCustomerContacts1700000000065', () => {
  test('creates the table and its indexes once', async () => {
    const fresh = runner(false);
    await new CreateCustomerContacts1700000000065().up(fresh);
    const sql = writes(fresh);
    expect(sql[0]).toMatch(/^CREATE TABLE customer_contacts \(/);
    expect(sql.slice(1)).toEqual([
      'CREATE INDEX idx_customer_contacts_subscription ON customer_contacts (subscription_id, created_at)',
      'CREATE INDEX idx_customer_contacts_user ON customer_contacts (user_id)'
    ]);

    const done = runner(true);
    await new CreateCustomerContacts1700000000065().up(done);
    expect(writes(done)).toEqual([]);
  });

  test('drops the table on down', async () => {
    const queryRunner = runner(true);
    await new CreateCustomerContacts1700000000065().down(queryRunner);
    expect(writes(queryRunner)).toEqual(['DROP TABLE customer_contacts']);
  });
});
