const request = require('supertest');
const { createApp } = require('../src/app');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { issueJwtToken } = require('../src/core/jwt-token');
const { parseNfeCustomerInput } = require('../src/api/validators/admin-nfe.validator');
const { BlingClient } = require('../src/infrastructure/bling/bling-client');
const { BlingNfeService } = require('../src/services/bling-nfe.service');

const NOW = new Date('2026-11-02T17:00:00Z');
const input = {
  name: 'Ana Correta',
  email: 'ana@example.com',
  document: '52998224725',
  address: { street: 'Rua Nova', number: '10', complement: '', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipcode: '80010000' }
};

function fakeRepository(seed) {
  const rows = new Map(seed.map((row) => [row.id, row]));
  return {
    rows,
    findById: jest.fn(async (id) => ({ ...rows.get(Number(id)) })),
    update: jest.fn(async (id, patch) => { Object.assign(rows.get(id), patch); }),
    requeue: jest.fn(async () => true),
    findCustomer: jest.fn(async () => ({ name: 'Do perfil', email: 'perfil@example.com', taxDocument: '', address: {} }))
  };
}

function row(overrides = {}) {
  return { id: 1, status: 'rejected', userId: 7, stripeInvoiceId: 'in_1', stripeAccount: 'br', blingSituacao: 4, attempts: 1, requestPayload: null, ...overrides };
}

function blingNote(overrides = {}) {
  return {
    id: 40,
    situacao: 4,
    numero: '000001',
    chaveAcesso: '',
    xml: '',
    linkDanfe: 'https://bling/danfe',
    linkPDF: 'https://bling/pdf',
    itens: [{ codigo: 'A', cfop: '6101' }],
    contato: { id: 9, nome: 'Ana Errada', email: 'ana@example.com', numeroDocumento: '52998224725', endereco: { endereco: 'Rua Velha', numero: '1', complemento: 'Casa', bairro: 'Centro', municipio: 'Curitiba', uf: 'PR', cep: '80010-000' } },
    ...overrides
  };
}

function build(seed, client = {}) {
  const repository = fakeRepository(seed);
  const auditService = { record: jest.fn(async () => {}) };
  const service = new BlingNfeService({ repository, auditService, client: { isConfigured: () => true, ...client }, naturezaOperacaoId: 1, now: () => NOW });
  return { service, repository, auditService };
}

describe('BlingNfeService.updateCustomer', () => {
  test('saves the data and calls nothing in Bling', async () => {
    const getNfe = jest.fn();
    const updateNfe = jest.fn();
    const { service, repository } = build([row({ blingNfeId: 40, blingOrderId: 30 })], { getNfe, updateNfe });
    await service.updateCustomer(1, input, {});
    expect(repository.rows.get(1)).toMatchObject({ customerName: 'Ana Correta', customerDocument: '52998224725', customerAddress: input.address });
    expect(getNfe).not.toHaveBeenCalled();
    expect(updateNfe).not.toHaveBeenCalled();
    expect(repository.requeue).not.toHaveBeenCalled();
  });

  test('records who changed it, without the personal data', async () => {
    const { service, auditService } = build([row()]);
    await service.updateCustomer(1, input, { id: 3 });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ actor: { id: 3 }, action: 'nfe.customer.update', targetUserId: 7 }));
    expect(JSON.stringify(auditService.record.mock.calls[0][0].metadata)).not.toContain('52998224725');
  });

  test('a new document forgets the contact while no order exists yet', async () => {
    const { service, repository } = build([row({ blingContactId: 9, customerDocument: '11144477735' })]);
    await service.updateCustomer(1, input, {});
    expect(repository.rows.get(1).blingContactId).toBeNull();
  });

  test.each([
    ['authorized', row({ status: 'authorized', blingSituacao: 5 })],
    ['submitted', row({ status: 'submitted', blingSituacao: 3 })],
    ['canceled', row({ status: 'canceled', blingSituacao: 2 })],
    ['denied', row({ status: 'rejected', blingSituacao: 9 })],
    ['imported', row({ stripeInvoiceId: 'bling:40' })]
  ])('refuses a note that is %s', async (_name, seed) => {
    const { service, repository } = build([seed]);
    await expect(service.updateCustomer(1, input, {})).rejects.toMatchObject({ statusCode: 409, details: { code: 'nfe_not_editable' } });
    expect(repository.update).not.toHaveBeenCalled();
  });

  test('a retry keeps the corrected data instead of reading the profile again', async () => {
    const seed = row({ status: 'blocked_missing_document', blingSituacao: null, customerName: 'Ana Correta', requestPayload: { customer_edited_at: NOW.toISOString() } });
    const { service, repository } = build([seed]);
    await service.retry(1, {});
    expect(repository.findCustomer).not.toHaveBeenCalled();
    expect(repository.rows.get(1).customerName).toBe('Ana Correta');
    expect(repository.requeue).toHaveBeenCalled();
  });

  test('the detail says what can be changed', async () => {
    const { service } = build([row()]);
    await expect(service.detail(1, {})).resolves.toMatchObject({ data: { can_edit: true } });
    const authorized = build([row({ status: 'authorized', blingSituacao: 5 })]);
    await expect(authorized.service.detail(1, {})).resolves.toMatchObject({ data: { can_edit: false } });
  });
});

describe('applying the correction in the job', () => {
  const edited = () => row({
    blingNfeId: 40,
    customerName: 'Ana Correta',
    customerEmail: 'ana@example.com',
    customerDocument: '52998224725',
    customerAddress: input.address,
    requestPayload: { customer_edited_at: NOW.toISOString() }
  });

  test('sends the note back with the new customer and what Bling calculated stays out', async () => {
    const updateNfe = jest.fn(async () => ({ id: 0 }));
    const { service } = build([edited()], { getNfe: jest.fn(async () => blingNote()), updateNfe });
    await service.applyCustomerEdit(edited(), 40);
    const [id, payload] = updateNfe.mock.calls[0];
    expect(id).toBe(40);
    expect(payload).toMatchObject({ numero: '000001', itens: [{ codigo: 'A', cfop: '6101' }] });
    expect(payload.contato).toMatchObject({ id: 9, nome: 'Ana Correta', endereco: { endereco: 'Rua Nova', numero: '10', complemento: 'Casa', cep: '80010000' } });
    for (const field of ['id', 'situacao', 'chaveAcesso', 'xml', 'linkDanfe', 'linkPDF']) {
      expect(payload).not.toHaveProperty(field);
    }
  });

  test('does nothing for a note nobody corrected', async () => {
    const getNfe = jest.fn();
    const { service } = build([row()], { getNfe });
    await service.applyCustomerEdit(row(), 40);
    expect(getNfe).not.toHaveBeenCalled();
  });

  test('a second try finds the data already there', async () => {
    const updateNfe = jest.fn();
    const contato = { id: 9, nome: 'Ana Correta', email: 'ana@example.com', numeroDocumento: '529.982.247-25', endereco: { endereco: 'Rua Nova', numero: '10', complemento: 'Casa', bairro: 'Centro', municipio: 'Curitiba', uf: 'PR', cep: '80010-000' } };
    const { service } = build([edited()], { getNfe: jest.fn(async () => blingNote({ contato })), updateNfe });
    await service.applyCustomerEdit(edited(), 40);
    expect(updateNfe).not.toHaveBeenCalled();
  });

  test('never touches a note already authorized in Bling', async () => {
    const updateNfe = jest.fn();
    const { service } = build([edited()], { getNfe: jest.fn(async () => blingNote({ situacao: 5 })), updateNfe });
    await service.applyCustomerEdit(edited(), 40);
    expect(updateNfe).not.toHaveBeenCalled();
  });
});

describe('customer input', () => {
  test('cleans what it accepts', () => {
    expect(parseNfeCustomerInput({ ...input, document: '529.982.247-25', address: { ...input.address, state: 'pr', zipcode: '80010-000' } }))
      .toMatchObject({ document: '52998224725', address: { state: 'PR', zipcode: '80010000' } });
  });

  test.each([
    ['an invalid document', { document: '11111111111' }, 'invalid_tax_document'],
    ['a CNPJ', { document: '11222333000181' }, 'invalid_tax_document'],
    ['a single name', { name: 'Ana' }, 'invalid_nfe_customer'],
    ['a missing name', { name: ' ' }, 'invalid_nfe_customer'],
    ['a bad email', { email: 'x' }, 'invalid_nfe_customer'],
    ['a bad zip code', { address: { ...input.address, zipcode: '123' } }, 'invalid_nfe_customer'],
    ['a missing number', { address: { ...input.address, number: '' } }, 'invalid_nfe_customer']
  ])('refuses %s', (_name, change, code) => {
    expect(() => parseNfeCustomerInput({ ...input, ...change })).toThrow(expect.objectContaining({ details: { code } }));
  });
});

describe('PATCH /api/v1/admin/nfe/:id/customer', () => {
  const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
  const bearer = () => `Bearer ${issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) })}`;
  const appFor = (role, blingNfeService) => createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: async () => ({ id: 1, roles: [role], permissions: ROLE_PERMISSIONS[role], markets: ['BR'] }) },
    blingNfeService
  });

  test.each(['admin', 'operator'])('%s corrects', async (role) => {
    const updateCustomer = jest.fn(async () => ({ success: true, data: { id: 1 } }));
    const response = await request(appFor(role, { updateCustomer })).patch('/api/v1/admin/nfe/1/customer').set('Authorization', bearer()).send(input);
    expect(response.status).toBe(200);
    expect(updateCustomer).toHaveBeenCalled();
  });

  test('readonly cannot', async () => {
    const updateCustomer = jest.fn();
    const response = await request(appFor('readonly', { updateCustomer })).patch('/api/v1/admin/nfe/1/customer').set('Authorization', bearer()).send(input);
    expect(response.status).toBe(403);
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  test('bad data never reaches the service', async () => {
    const updateCustomer = jest.fn();
    const response = await request(appFor('admin', { updateCustomer })).patch('/api/v1/admin/nfe/1/customer').set('Authorization', bearer()).send({ ...input, document: '123' });
    expect(response.status).toBe(422);
    expect(updateCustomer).not.toHaveBeenCalled();
  });
});

describe('deleting a note', () => {
  test('the Bling client has no way to delete anything', () => {
    const methods = Object.getOwnPropertyNames(BlingClient.prototype);
    expect(methods.filter((name) => /delete|remove|destroy/i.test(name))).toEqual([]);
  });
});

describe('NF-e customer correction reason', () => {
  const body = { name: 'Ana Correta', email: 'ana@example.com', document: '529.982.247-25', address: { street: 'Rua B', number: '2', neighborhood: 'Centro', city: 'SP', state: 'sp', zipcode: '01001-000' } };

  test('keeps a trimmed reason and refuses one outside 3 to 255 characters', () => {
    expect(parseNfeCustomerInput({ ...body, reason: '  CPF digitado errado  ' }).reason).toBe('CPF digitado errado');
    expect(parseNfeCustomerInput(body).reason).toBeUndefined();
    for (const reason of ['x', 'a'.repeat(256)]) {
      expect(() => parseNfeCustomerInput({ ...body, reason })).toThrow(expect.objectContaining({ statusCode: 422, details: { code: 'invalid_nfe_customer' } }));
    }
  });

  test('records the reason in the audit event and nowhere in the note', async () => {
    const { service, repository, auditService } = build([row()]);
    await service.updateCustomer(1, { ...input, reason: 'CPF digitado errado no checkout' }, { id: 3 });
    expect(auditService.record.mock.calls[0][0].metadata).toMatchObject({ reason: 'CPF digitado errado no checkout' });
    expect(JSON.stringify(repository.rows.get(1))).not.toContain('CPF digitado errado');
  });

  test('without a reason the audit event has none', async () => {
    const { service, auditService } = build([row()]);
    await service.updateCustomer(1, input, { id: 3 });
    expect(auditService.record.mock.calls[0][0].metadata).not.toHaveProperty('reason');
  });
});
