const { BlingNfeService } = require('../src/services/bling-nfe.service');
const { BlingApiError, BlingClient, BlingNotConnectedError } = require('../src/infrastructure/bling/bling-client');
const { StripeWebhookService } = require('../src/services/stripe-webhook.service');
const { buildNfeOrderLines, nfeStatusFromSituacao, protocolFromXml } = require('../src/core/nfe');

const CPF = '52998224725';
const NOW = new Date('2026-10-31T12:00:00Z');

function memoryRepository(customer = { name: 'Ana Costa', email: 'ana@example.com', taxDocument: CPF, address: { street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'SP', state: 'SP', zipcode: '01001000' } }) {
  const rows = new Map();
  let nextId = 1;
  return {
    rows,
    findCustomer: jest.fn(async () => customer),
    findById: jest.fn(async (id) => rows.get(id) || null),
    findByStripeInvoice: jest.fn(async (account, invoiceId) => [...rows.values()].find((row) => row.stripeAccount === account && row.stripeInvoiceId === invoiceId) || null),
    insertOrGet: jest.fn(async (input) => {
      const found = [...rows.values()].find((row) => row.stripeInvoiceId === input.stripeInvoiceId);
      if (found) return found;
      const row = { id: nextId, attempts: 0, blingContactId: null, blingOrderId: null, blingNfeId: null, ...input };
      rows.set(nextId, row);
      nextId += 1;
      return row;
    }),
    update: jest.fn(async (id, patch) => { Object.assign(rows.get(id), patch); }),
    requeue: jest.fn(async (id) => {
      const row = rows.get(id);
      if (!['error', 'rejected', 'blocked_missing_document'].includes(row.status)) return false;
      row.status = 'pending';
      return true;
    }),
    listBlockedForUser: jest.fn(async (userId) => [...rows.values()].filter((row) => row.userId === userId && row.status === 'blocked_missing_document')),
    listDue: jest.fn(async () => [...rows.values()].filter((row) => ['pending', 'error', 'submitted'].includes(row.status) && row.nextAttemptAt))
  };
}

function fakeClient(overrides = {}) {
  return {
    isConfigured: () => true,
    isConnected: async () => true,
    keepAlive: jest.fn(async () => {}),
    findContactByDocument: jest.fn(async () => null),
    createContact: jest.fn(async () => ({ id: 10 })),
    getContact: jest.fn(async () => null),
    updateContact: jest.fn(async () => ({ id: 10 })),
    findProductByCode: jest.fn(async () => ({ id: 20 })),
    createProduct: jest.fn(async () => ({ id: 21 })),
    findOrderByStoreNumber: jest.fn(async () => null),
    createOrder: jest.fn(async () => ({ id: 30 })),
    getOrder: jest.fn(async () => ({ id: 30 })),
    generateNfe: jest.fn(async () => ({ idNotaFiscal: 40 })),
    getNfe: jest.fn()
      .mockResolvedValueOnce({ id: 40, situacao: 1 })
      .mockResolvedValue({ id: 40, situacao: 5, numero: '158', serie: 1, chaveAcesso: '3525', linkDanfe: 'https://bling/danfe', linkPDF: 'https://bling/pdf', xml: 'https://bling/xml' }),
    sendNfe: jest.fn(async () => ({})),
    ...overrides
  };
}

const paidInvoice = {
  id: 'in_1',
  total: 15000,
  currency: 'brl',
  status_transitions: { paid_at: 1793448000 },
  lines: {
    data: [
      { amount: 14000, quantity: 2, description: 'Recipe', pricing: { price_details: { product: 'prod_food', price: 'price_food' } } },
      { amount: 3000, quantity: 1, description: 'Shipping', pricing: { price_details: { product: 'prod_ship', price: 'price_ship' } } }
    ]
  },
  total_discount_amounts: [{ amount: 2000 }]
};

function build({ repository = memoryRepository(), client = fakeClient(), naturezaOperacaoId = 99, ledgerRepository, addressIssueService } = {}) {
  const billing = { shippingProductId: 'prod_ship', retrieveInvoiceWithLines: jest.fn(async () => paidInvoice) };
  const service = new BlingNfeService({
    repository,
    client,
    naturezaOperacaoId,
    billingFor: () => billing,
    ledgerRepository,
    addressIssueService,
    now: () => NOW,
    logger: { error() {}, warn() {}, info() {} }
  });
  return { service, repository, client, billing };
}

const record = (service, overrides = {}) => service.recordPaidInvoice({
  invoice: paidInvoice,
  account: 'br',
  userId: 7,
  subscriptionId: 'sub_1',
  ...overrides
});

describe('recordPaidInvoice', () => {
  test('does not emit for the US account or a zero total', async () => {
    const { service, repository } = build();
    expect(await record(service, { account: 'us' })).toBeNull();
    expect(await record(service, { invoice: { ...paidInvoice, total: 0 } })).toBeNull();
    expect(repository.insertOrGet).not.toHaveBeenCalled();
  });

  test('the note names the buyer, not the delivery recipient', async () => {
    const { service, repository } = build({
      repository: memoryRepository({
        name: 'Ana Costa',
        email: 'ana@example.com',
        taxDocument: CPF,
        address: { recipient_name: 'João Lima', street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'SP', state: 'SP', zipcode: '01001000' }
      })
    });
    await record(service);
    const [row] = [...repository.rows.values()];
    expect(row.customerName).toBe('Ana Costa');
    expect(JSON.stringify(row.customerAddress)).not.toContain('João Lima');
  });

  test('a CPF without a fiscal name blocks the note with missing_fields, and Bling is not called', async () => {
    const { service, repository, client } = build({
      repository: memoryRepository({ name: '', email: 'ana@example.com', taxDocument: CPF, address: { street: 'Rua A' } })
    });
    await record(service);
    const [row] = [...repository.rows.values()];
    expect(row.status).toBe('blocked_missing_document');
    expect(row.missingFields).toEqual(['fiscal_name']);
    expect(row.customerName).toBeNull();
    expect(row.nextAttemptAt).toBeNull();
    await service.runDue();
    expect(client.createContact).not.toHaveBeenCalled();
  });

  test('without CPF and fiscal name both are listed', async () => {
    const { service, repository } = build({ repository: memoryRepository({ name: 'Ana', email: 'a@b.c', taxDocument: '', address: {} }) });
    await record(service);
    const [row] = [...repository.rows.values()];
    expect(row.missingFields).toEqual(['tax_document', 'fiscal_name']);
  });

  test('the note copies the address of its subscription', async () => {
    const { service, repository } = build();
    await record(service);
    expect(repository.findCustomer).toHaveBeenCalledWith(7, 'sub_1');
    const [row] = [...repository.rows.values()];
    expect(row.status).toBe('pending');
    expect(row.missingFields).toEqual([]);
    expect(row.customerAddress).toMatchObject({ street: 'Rua A', number: '1', neighborhood: 'Centro' });
  });

  test('a subscription that ships from no market gets no note, and the payment is not stopped', async () => {
    const ledgerRepository = { findByStripeSubscriptionId: jest.fn(async () => ({ stripeAccount: 'br', address: { country: 'US' } })) };
    const { service, repository } = build({ ledgerRepository });
    await expect(record(service)).resolves.toBeNull();
    expect(repository.insertOrGet).not.toHaveBeenCalled();
    expect(ledgerRepository.findByStripeSubscriptionId).toHaveBeenCalledWith('sub_1');
  });

  test('a Brazil subscription delivered in Brazil gets its note', async () => {
    const ledgerRepository = { findByStripeSubscriptionId: jest.fn(async () => ({ stripeAccount: 'br', address: { country: 'BR' } })) };
    const { service, repository } = build({ ledgerRepository });
    await record(service);
    expect(repository.rows.size).toBe(1);
  });

  test('a repeated webhook keeps one row', async () => {
    const { service, repository } = build();
    const first = await record(service);
    const second = await record(service);
    expect(second.id).toBe(first.id);
    expect(repository.rows.size).toBe(1);
  });

  test('two events racing past the lookup still meet the unique key', async () => {
    const { service, repository } = build();
    repository.findByStripeInvoice.mockResolvedValue(null);
    await Promise.all([record(service), record(service)]);
    expect(repository.rows.size).toBe(1);
  });

  test('without a valid document the note is blocked and Bling is not called', async () => {
    const { service, repository, client } = build({ repository: memoryRepository({ name: 'Ana', email: 'a@b.co', taxDocument: '12345678901', address: {} }) });
    const row = await record(service);
    expect(row.status).toBe('blocked_missing_document');
    await service.runDue();
    expect(repository.rows.get(row.id).status).toBe('blocked_missing_document');
    expect(client.findContactByDocument).not.toHaveBeenCalled();
    expect(client.createContact).not.toHaveBeenCalled();
  });
});

describe('runDue', () => {
  test('emits nothing while Bling is not configured, and the row waits', async () => {
    const { service, repository, client } = build({ naturezaOperacaoId: 0 });
    const row = await record(service);
    expect(await service.runDue()).toEqual({ skipped: true });
    expect(repository.rows.get(row.id).status).toBe('pending');
    expect(client.createContact).not.toHaveBeenCalled();
  });

  test('creates contact, order and NF-e, and stores the authorized note', async () => {
    const { service, repository, client } = build();
    const { id } = await record(service);
    expect(await service.runDue()).toMatchObject({ scanned: 1, done: 1, failed: 0 });

    const order = client.createOrder.mock.calls[0][0];
    expect(order).toMatchObject({
      numeroLoja: 'in_1',
      contato: { id: 10 },
      transporte: { frete: 30 },
      desconto: { valor: 20, unidade: 'REAL' }
    });
    expect(order.itens[0]).toMatchObject({ quantidade: 2, valor: 70, naturezaOperacao: { id: 99 } });
    expect(client.createContact.mock.calls[0][0]).toMatchObject({ tipo: 'F', numeroDocumento: CPF });

    const row = repository.rows.get(id);
    expect(row).toMatchObject({
      status: 'authorized',
      blingContactId: 10,
      blingOrderId: 30,
      blingNfeId: 40,
      nfeNumber: '158',
      nfeSeries: '1',
      accessKey: '3525',
      danfeUrl: 'https://bling/danfe',
      xmlUrl: 'https://bling/xml',
      attempts: 1,
      lastError: null,
      nextAttemptAt: null
    });
    expect(row.requestPayload.order.numeroLoja).toBe('in_1');
    expect(JSON.stringify([row.requestPayload, row.responsePayload])).not.toMatch(/token/i);
  });

  test('a Bling error stays on the row, with a next attempt', async () => {
    const client = fakeClient({ createOrder: jest.fn(async () => { throw new BlingApiError('Bling answered 500.', { status: 500 }); }) });
    const { service, repository } = build({ client });
    const { id } = await record(service);
    expect(await service.runDue()).toMatchObject({ failed: 1 });
    const row = repository.rows.get(id);
    expect(row).toMatchObject({ status: 'error', attempts: 1, lastError: 'Bling answered 500.', blingContactId: 10 });
    expect(row.nextAttemptAt.getTime()).toBe(NOW.getTime() + 5 * 60 * 1000);
  });

  test('a 403 records the error and stops the job for that note', async () => {
    const client = fakeClient({ generateNfe: jest.fn(async () => { throw new BlingApiError('Escopo ausente', { status: 403 }); }) });
    const { service, repository } = build({ client });
    const { id } = await record(service);
    await service.runDue();
    expect(repository.rows.get(id)).toMatchObject({ status: 'error', lastError: 'Escopo ausente', nextAttemptAt: null });
    await service.runDue();
    expect(client.generateNfe).toHaveBeenCalledTimes(1);
  });

  test('a retry resumes from the saved ids and repeats no create', async () => {
    const client = fakeClient();
    client.sendNfe.mockRejectedValueOnce(new BlingApiError('timeout', { status: 0 }));
    client.getNfe = jest.fn(async () => ({ id: 40, situacao: 1 }));
    const { service, repository } = build({ client });
    const { id } = await record(service);
    await service.runDue();
    expect(repository.rows.get(id)).toMatchObject({ status: 'error', blingNfeId: 40 });

    client.getNfe = jest.fn().mockResolvedValueOnce({ id: 40, situacao: 1 }).mockResolvedValue({ id: 40, situacao: 3 });
    await service.runDue();
    expect(repository.rows.get(id).status).toBe('submitted');
    expect(client.createContact).toHaveBeenCalledTimes(1);
    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(client.generateNfe).toHaveBeenCalledTimes(1);
  });

  test('an order or NF-e created by a call that timed out here is reused', async () => {
    const client = fakeClient({
      findOrderByStoreNumber: jest.fn(async () => ({ id: 31, numeroLoja: 'in_1' })),
      getOrder: jest.fn(async () => ({ id: 31, notaFiscal: { id: 41 } }))
    });
    const { service, repository } = build({ client });
    const { id } = await record(service);
    await service.runDue();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(client.generateNfe).not.toHaveBeenCalled();
    expect(repository.rows.get(id)).toMatchObject({ blingOrderId: 31, blingNfeId: 41 });
  });

  test('a note already sent is not sent again', async () => {
    const client = fakeClient({ getNfe: jest.fn(async () => ({ id: 40, situacao: 8 })) });
    const { service, repository } = build({ client });
    const { id } = await record(service);
    await service.runDue();
    expect(client.sendNfe).not.toHaveBeenCalled();
    expect(repository.rows.get(id).status).toBe('submitted');
  });

  test('a SEFAZ rejection on send becomes rejected, with the reason', async () => {
    const client = fakeClient({
      sendNfe: jest.fn(async () => { throw new BlingApiError('Rejeição 539', { status: 400 }); }),
      getNfe: jest.fn().mockResolvedValueOnce({ id: 40, situacao: 1 }).mockResolvedValue({ id: 40, situacao: 4 })
    });
    const { service, repository } = build({ client });
    const { id } = await record(service);
    await service.runDue();
    expect(repository.rows.get(id)).toMatchObject({ status: 'rejected', lastError: 'Rejeição 539', nextAttemptAt: null });
  });

  test('keeps the fields Bling names when it refuses to send, and the detail returns them', async () => {
    const fields = [{ element: 'itens[0].unidadeTributavel', message: 'Há informações obrigatórias faltando na nota' }];
    const client = fakeClient({
      sendNfe: jest.fn(async () => { throw new BlingApiError('Não foi possível emitir a nota fiscal', { status: 400, fields }); }),
      getNfe: jest.fn(async () => ({ id: 40, situacao: 1 }))
    });
    const { service, repository } = build({ client });
    const { id } = await record(service);
    await service.runDue();
    expect(repository.rows.get(id).status).toBe('error');
    const { data } = await service.detail(id);
    expect(data.bling_problems).toEqual(fields);
  });

  test('an authorized note shows no old Bling problem', async () => {
    const { service, repository } = build();
    const { id } = await record(service);
    repository.rows.get(id).responsePayload = { error_detail: { fields: [{ element: 'x', message: 'y' }] } };
    repository.rows.get(id).status = 'authorized';
    expect((await service.detail(id)).data.bling_problems).toEqual([]);
  });

  test('polls a submitted note until it resolves', async () => {
    const client = fakeClient({ getNfe: jest.fn(async () => ({ id: 40, situacao: 3 })) });
    const { service, repository } = build({ client });
    const { id } = await record(service);
    await service.runDue();
    repository.rows.get(id).blingNfeId = 40;
    client.getNfe = jest.fn(async () => ({ id: 40, situacao: 6, numero: '9' }));
    await service.runDue();
    expect(repository.rows.get(id)).toMatchObject({ status: 'authorized', authorizedAt: NOW });
  });

  test('a lost grant keeps the note due and spends no attempt', async () => {
    const client = fakeClient({ findContactByDocument: jest.fn(async () => { throw new BlingNotConnectedError(); }) });
    const { service, repository } = build({ client });
    const { id } = await record(service);
    expect(await service.runDue()).toMatchObject({ reason: 'bling_not_connected' });
    expect(repository.rows.get(id)).toMatchObject({ status: 'pending', attempts: 0 });
  });
});

describe('reading the customer again', () => {
  test('a pending note takes the subscription address saved before the job ran', async () => {
    const customer = { name: 'Ana Costa', email: 'a@b.co', taxDocument: CPF, address: { street: 'Rua Velha', city: 'Curitiba' } };
    const { service, repository, client } = build({ repository: memoryRepository(customer) });
    const { id } = await record(service);
    customer.address = { street: 'Rua Nova', number: '9', city: 'Londrina' };
    await service.runDue();
    expect(repository.rows.get(id).customerAddress).toMatchObject({ street: 'Rua Nova', city: 'Londrina' });
    expect(client.createContact.mock.calls[0][0].endereco.geral).toMatchObject({ endereco: 'Rua Nova', municipio: 'Londrina' });
  });

  test('the job keeps the operator correction', async () => {
    const customer = { name: 'Ana Costa', email: 'a@b.co', taxDocument: CPF, address: { street: 'Rua Velha', city: 'Curitiba' } };
    const { service, repository } = build({ repository: memoryRepository(customer) });
    const { id } = await record(service);
    Object.assign(repository.rows.get(id), {
      customerAddress: { street: 'Rua do Operador', city: 'Maringá' },
      requestPayload: { customer_edited_at: '2026-11-01T00:00:00Z' }
    });
    customer.address = { street: 'Rua Nova', city: 'Londrina' };
    await service.runDue();
    expect(repository.rows.get(id).customerAddress).toEqual({ street: 'Rua do Operador', city: 'Maringá' });
  });

  test('a pending note whose customer lost the fiscal name goes back to blocked', async () => {
    const customer = { name: 'Ana Costa', email: 'a@b.co', taxDocument: CPF, address: {} };
    const { service, repository, client } = build({ repository: memoryRepository(customer) });
    const { id } = await record(service);
    customer.name = '';
    await service.runDue();
    expect(repository.rows.get(id)).toMatchObject({ status: 'blocked_missing_document', missingFields: ['fiscal_name'], nextAttemptAt: null });
    expect(client.createContact).not.toHaveBeenCalled();
  });

  test('refreshBlockedForUser requeues the blocked notes that became complete', async () => {
    const customer = { name: '', email: 'a@b.co', taxDocument: CPF, address: {} };
    const { service, repository } = build({ repository: memoryRepository(customer) });
    const { id } = await record(service);
    expect(await service.refreshBlockedForUser(7)).toEqual({ requeued: 0 });
    expect(repository.rows.get(id).status).toBe('blocked_missing_document');

    customer.name = 'Ana Costa';
    expect(await service.refreshBlockedForUser(7)).toEqual({ requeued: 1 });
    expect(repository.rows.get(id)).toMatchObject({ status: 'pending', customerName: 'Ana Costa', missingFields: [] });
    expect(repository.listBlockedForUser).toHaveBeenCalledWith(7);
  });

  test('refreshBlockedForUser leaves an operator-corrected note alone', async () => {
    const customer = { name: '', email: 'a@b.co', taxDocument: CPF, address: {} };
    const { service, repository } = build({ repository: memoryRepository(customer) });
    const { id } = await record(service);
    repository.rows.get(id).requestPayload = { customer_edited_at: '2026-11-01T00:00:00Z' };
    customer.name = 'Ana Costa';
    expect(await service.refreshBlockedForUser(7)).toEqual({ requeued: 0 });
    expect(repository.rows.get(id).status).toBe('blocked_missing_document');
  });
});

describe('nfe_check (delivery-address-issues)', () => {
  const ledger = { id: 5, stripeSubscriptionId: 'sub_1', userId: 7, stripeAccount: 'br', address: { country: 'BR' } };

  test('a note blocked when recorded reports the subscription; a complete note does not', async () => {
    const addressIssueService = { report: jest.fn() };
    const ledgerRepository = { findByStripeSubscriptionId: jest.fn(async () => ledger) };
    const blocked = build({ repository: memoryRepository({ name: '', email: 'a@b.c', taxDocument: CPF, address: {} }), ledgerRepository, addressIssueService });
    await record(blocked.service);
    expect(addressIssueService.report).toHaveBeenCalledWith({ subscription: ledger, source: 'nfe_check' });

    const fine = { report: jest.fn() };
    await record(build({ ledgerRepository, addressIssueService: fine }).service);
    expect(fine.report).not.toHaveBeenCalled();
  });

  test('a note blocked by the job reports the subscription', async () => {
    const customer = { name: 'Ana Costa', email: 'a@b.c', taxDocument: CPF, address: {} };
    const addressIssueService = { report: jest.fn() };
    const ledgerRepository = { findByStripeSubscriptionId: jest.fn(async () => ledger) };
    const { service } = build({ repository: memoryRepository(customer), ledgerRepository, addressIssueService });
    await record(service);
    customer.taxDocument = '';
    await service.runDue();
    expect(addressIssueService.report).toHaveBeenCalledWith({ subscription: ledger, source: 'nfe_check' });
  });
});

describe('detail', () => {
  test('returns what a blocked note is missing', async () => {
    const { service, repository } = build({ repository: memoryRepository({ name: '', email: 'a@b.c', taxDocument: CPF, address: {} }) });
    const { id } = await record(service);
    const { data } = await service.detail(id);
    expect(data).toMatchObject({ status: 'blocked_missing_document', missing_fields: ['fiscal_name'] });
    repository.rows.get(id).missingFields = null;
    expect((await service.detail(id)).data.missing_fields).toEqual([]);
  });
});

describe('detail subscription_id', () => {
  test('returns the panel id of the subscription the note bills', async () => {
    const ledgerRepository = { findByStripeSubscriptionId: jest.fn(async () => ({ id: 12, stripeAccount: 'br', address: { country: 'BR' } })) };
    const { service } = build({ ledgerRepository });
    const { id } = await record(service);
    expect((await service.detail(id)).data.subscription_id).toBe(12);
  });

  test('is null when no subscription is found', async () => {
    const { service } = build();
    const { id } = await record(service);
    expect((await service.detail(id)).data.subscription_id).toBeNull();
  });
});

describe('detail address_issue', () => {
  test('returns the problem of the note subscription', async () => {
    const issue = { id: 3, codes: ['fiscal_name_missing'], email_sent_at: '2026-11-03T12:00:00.000Z' };
    const addressIssueService = { report: jest.fn(), latestFor: jest.fn(async () => issue) };
    const ledgerRepository = { findByStripeSubscriptionId: jest.fn(async () => ({ id: 5, stripeAccount: 'br', address: { country: 'BR' } })) };
    const { service } = build({ repository: memoryRepository({ name: '', email: 'a@b.c', taxDocument: CPF, address: {} }), ledgerRepository, addressIssueService });
    const { id } = await record(service);
    const { data } = await service.detail(id);
    expect(data).toMatchObject({ missing_fields: ['fiscal_name'], address_issue: issue });
    expect(addressIssueService.latestFor).toHaveBeenCalledWith(5);
  });
});

describe('the Bling contact follows the note', () => {
  const blingContact = (overrides = {}) => ({
    id: 11,
    nome: 'Ana Costa',
    numeroDocumento: CPF,
    endereco: { geral: { endereco: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'SP', uf: 'SP', cep: '01001-000' } },
    ...overrides
  });

  test('a contact equal to the note is not updated', async () => {
    const client = fakeClient({ findContactByDocument: jest.fn(async () => ({ id: 11 })), getContact: jest.fn(async () => blingContact()) });
    const { service } = build({ client });
    await record(service);
    await service.runDue();
    expect(client.getContact).toHaveBeenCalledWith(11);
    expect(client.updateContact).not.toHaveBeenCalled();
    expect(client.createContact).not.toHaveBeenCalled();
    expect(client.createOrder.mock.calls[0][0].contato).toEqual({ id: 11 });
  });

  test('a customer who moved gets the contact updated before the order', async () => {
    const client = fakeClient({
      findContactByDocument: jest.fn(async () => ({ id: 11 })),
      getContact: jest.fn(async () => blingContact({ endereco: { geral: { endereco: 'Rua Velha', numero: '1', municipio: 'SP' } } }))
    });
    const { service, repository } = build({ client });
    const { id } = await record(service);
    await service.runDue();
    const [contactId, payload] = client.updateContact.mock.calls[0];
    expect(contactId).toBe(11);
    expect(payload).toMatchObject({ nome: 'Ana Costa', numeroDocumento: CPF, endereco: { geral: { endereco: 'Rua A', bairro: 'Centro' } } });
    expect(client.updateContact.mock.invocationCallOrder[0]).toBeLessThan(client.createOrder.mock.invocationCallOrder[0]);
    expect(repository.rows.get(id).requestPayload.contact_update).toMatchObject({ nome: 'Ana Costa' });
  });
});

describe('retry', () => {
  test.each(['error', 'rejected', 'blocked_missing_document'])('requeues %s', async (status) => {
    const { service, repository } = build();
    const { id } = await record(service);
    repository.rows.get(id).status = status;
    await service.retry(id);
    expect(repository.rows.get(id).status).toBe('pending');
  });

  test.each(['pending', 'submitted', 'authorized'])('refuses %s', async (status) => {
    const { service, repository } = build();
    const { id } = await record(service);
    repository.rows.get(id).status = status;
    await expect(service.retry(id)).rejects.toMatchObject({ statusCode: 409, details: { code: 'nfe_not_retryable' } });
    expect(repository.requeue).not.toHaveBeenCalled();
  });

  test('a blocked note takes the document saved after it was recorded', async () => {
    const customer = { name: 'Ana Costa', email: 'a@b.co', taxDocument: '', address: {} };
    const { service, repository } = build({ repository: memoryRepository(customer) });
    const { id } = await record(service);
    customer.taxDocument = CPF;
    await service.retry(id);
    expect(repository.rows.get(id)).toMatchObject({ status: 'pending', customerDocument: CPF });
  });

  test('a note that already has a Bling contact reads the customer again too', async () => {
    const customer = { name: 'Ana Costa', email: 'a@b.co', taxDocument: CPF, address: { city: 'Curitiba' } };
    const { service, repository } = build({ repository: memoryRepository(customer) });
    const { id } = await record(service);
    Object.assign(repository.rows.get(id), { status: 'error', blingContactId: 10 });
    customer.address = { city: 'Londrina' };
    await service.retry(id);
    expect(repository.rows.get(id)).toMatchObject({ status: 'pending', customerAddress: expect.objectContaining({ city: 'Londrina' }) });
  });

  test('an operator correction is kept on retry', async () => {
    const customer = { name: 'Ana Costa', email: 'a@b.co', taxDocument: CPF, address: { city: 'Curitiba' } };
    const { service, repository } = build({ repository: memoryRepository(customer) });
    const { id } = await record(service);
    Object.assign(repository.rows.get(id), {
      status: 'error',
      customerAddress: { city: 'Maringá' },
      requestPayload: { customer_edited_at: '2026-11-01T00:00:00Z' }
    });
    customer.address = { city: 'Londrina' };
    await service.retry(id);
    expect(repository.rows.get(id).customerAddress).toEqual({ city: 'Maringá' });
    expect(repository.findCustomer).toHaveBeenCalledTimes(1);
  });

  test('a blocked note with still no document stays blocked', async () => {
    const { service, repository } = build({ repository: memoryRepository({ name: 'Ana', email: 'a@b.co', taxDocument: '', address: {} }) });
    const { id } = await record(service);
    await service.retry(id);
    expect(repository.rows.get(id).status).toBe('blocked_missing_document');
  });
});

describe('invoice.paid', () => {
  function webhook(blingNfe) {
    const service = new StripeWebhookService({
      blingNfe,
      ledgerRepository: {
        findByStripeSubscriptionId: async () => ({ userId: 7 }),
        upsert: async () => {},
        updateCheckoutReference: async () => {}
      },
      logger: { error() {}, warn() {}, info() {} }
    });
    return service;
  }
  const invoice = { id: 'in_1', total: 100, customer: 'cus_1', subscription_details: { metadata: { eden_env: 'qa' } }, subscription: 'sub_1' };
  const runtime = { account: 'br', stripeBilling: { retrieveSubscription: async () => ({ metadata: { eden_env: 'qa' } }) } };

  beforeEach(() => { process.env.EDEN_RUNTIME = 'qa'; });

  test('records the note and never reaches Bling', async () => {
    const blingNfe = { recordPaidInvoice: jest.fn(async () => ({})) };
    await webhook(blingNfe).handleInvoicePaid(invoice, runtime, {});
    expect(blingNfe.recordPaidInvoice).toHaveBeenCalledWith(expect.objectContaining({ account: 'br', userId: 7, subscriptionId: 'sub_1' }));
  });

  test('skips an event of another environment', async () => {
    const blingNfe = { recordPaidInvoice: jest.fn() };
    await webhook(blingNfe).handleInvoicePaid(invoice, { ...runtime, stripeBilling: { retrieveSubscription: async () => ({ metadata: { eden_env: 'production' } }) } }, {});
    expect(blingNfe.recordPaidInvoice).not.toHaveBeenCalled();
  });

  test('a failed row finishes the other steps first, then the event retries', async () => {
    const failure = new Error('db down');
    const service = webhook({ recordPaidInvoice: jest.fn(async () => { throw failure; }) });
    service.recordChargedDelivery = jest.fn(async () => {});
    service.finishCustomerInvoice = jest.fn(async () => {});
    await expect(service.handleInvoicePaid(invoice, runtime, {})).rejects.toBe(failure);
    expect(service.recordChargedDelivery).toHaveBeenCalled();
    expect(service.finishCustomerInvoice).toHaveBeenCalled();
  });
});

describe('helpers', () => {
  test('the order closes on the invoice total', () => {
    const order = buildNfeOrderLines({
      lines: [
        { amountMinor: 10000, quantity: 3, code: 'A', description: 'A' },
        { amountMinor: -1000, quantity: 1, code: 'C', description: 'Credit' },
        { amountMinor: 500, quantity: 1, code: 'S', ship: true }
      ],
      totalMinor: 9000,
      isShipping: (line) => Boolean(line.ship)
    });
    expect(order.items).toEqual([{ code: 'A', description: 'A', quantity: 1, unitMinor: 10000 }]);
    expect(10000 + order.freightMinor - order.discountMinor + order.otherExpensesMinor).toBe(9000);
  });

  test('situacao uses the /nfe table', () => {
    expect(nfeStatusFromSituacao(4)).toBe('rejected');
    expect(nfeStatusFromSituacao(5)).toBe('authorized');
    expect(nfeStatusFromSituacao(6)).toBe('authorized');
    expect(nfeStatusFromSituacao(3)).toBe('submitted');
    expect(nfeStatusFromSituacao(9)).toBe('rejected');
  });

  test('the protocol is read from an inline XML only', () => {
    expect(protocolFromXml('<protNFe><nProt>135</nProt></protNFe>')).toBe('135');
    expect(protocolFromXml('https://bling/xml')).toBeNull();
  });
});

describe('BlingClient', () => {
  function connection(grant) {
    return {
      read: jest.fn(async () => grant),
      saveTokens: jest.fn(async () => {}),
      markNeedsAuthorization: jest.fn(async () => {}),
      saveState: jest.fn(async () => {}),
      consumeState: jest.fn(async () => true)
    };
  }
  function response(status, body) {
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  }
  const options = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x', now: () => NOW, wait: async () => {} };

  test('sends the code with Basic auth and stores the rotated tokens', async () => {
    const store = connection(null);
    const fetchImpl = jest.fn(async () => response(200, { access_token: 'a', refresh_token: 'r', expires_in: 21600 }));
    await new BlingClient({ ...options, connection: store, fetchImpl }).exchangeCode('code-1');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://bling.com.br/Api/v3/oauth/token');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    expect(init.body).toBe('grant_type=authorization_code&code=code-1');
    expect(store.saveTokens).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'a', refreshToken: 'r' }));
  });

  test('an expired access token is renewed before the call', async () => {
    const store = connection({ accessToken: 'old', refreshToken: 'r1', accessExpiresAt: new Date(NOW.getTime() - 1), refreshedAt: NOW, needsAuthorization: false });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(200, { access_token: 'new', refresh_token: 'r2', expires_in: 60 * 60 }))
      .mockResolvedValueOnce(response(200, { data: [] }));
    await new BlingClient({ ...options, connection: store, fetchImpl }).findContactByDocument(CPF);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
    expect(fetchImpl.mock.calls[1][0]).toContain('numeroDocumento=52998224725');
  });

  test('updateContact replaces the contact with PUT /contatos/{id} and the whole body', async () => {
    const store = connection({ accessToken: 'tok', refreshToken: 'r1', accessExpiresAt: new Date(NOW.getTime() + 3600000), refreshedAt: NOW, needsAuthorization: false });
    const fetchImpl = jest.fn(async () => response(200, { data: { id: 11 } }));
    const payload = { nome: 'Ana Costa', numeroDocumento: CPF, endereco: { geral: { endereco: 'Rua A' } } };
    await expect(new BlingClient({ ...options, connection: store, fetchImpl }).updateContact(11, payload)).resolves.toEqual({ id: 11 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.bling.com.br/Api/v3/contatos/11');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  test('a refused refresh asks for a new authorization', async () => {
    const store = connection({ accessToken: '', refreshToken: 'r1', accessExpiresAt: null, refreshedAt: NOW, needsAuthorization: false });
    const fetchImpl = jest.fn(async () => response(400, { error: 'invalid_grant' }));
    await expect(new BlingClient({ ...options, connection: store, fetchImpl }).getNfe(1)).rejects.toBeInstanceOf(BlingNotConnectedError);
    expect(store.markNeedsAuthorization).toHaveBeenCalled();
  });

  test('a 403 surfaces with its status and field messages', async () => {
    const store = connection({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: new Date(NOW.getTime() + 3600000), refreshedAt: NOW, needsAuthorization: false });
    const fetchImpl = jest.fn(async () => response(403, { error: { type: 'FORBIDDEN', message: 'Sem permissão', fields: [{ msg: 'escopo' }] } }));
    await expect(new BlingClient({ ...options, connection: store, fetchImpl }).sendNfe(1)).rejects.toMatchObject({ status: 403, message: 'Sem permissão · escopo' });
  });

  test('a validation error keeps which field each message is about, collection items included', async () => {
    const store = connection({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: new Date(NOW.getTime() + 3600000), refreshedAt: NOW, needsAuthorization: false });
    const fetchImpl = jest.fn(async () => response(400, { error: {
      type: 'VALIDATION_ERROR',
      message: 'Não foi possível emitir a nota fiscal',
      description: 'Verifique as informações e tente novamente.',
      fields: [
        { code: 1, msg: 'Há informações obrigatórias faltando na nota', element: 'itens', collection: [
          { index: 0, element: 'itens[0].pesoBruto', msg: 'Informe o peso bruto' }
        ] },
        { code: 2, msg: 'Informe o telefone', element: 'contato.telefone', collection: [] }
      ]
    } }));
    const error = await new BlingClient({ ...options, connection: store, fetchImpl }).sendNfe(1).catch((caught) => caught);
    expect(error.fields).toEqual([
      { element: 'itens[0].pesoBruto', message: 'Informe o peso bruto' },
      { element: 'contato.telefone', message: 'Informe o telefone' }
    ]);
    expect(error.message).toBe('Não foi possível emitir a nota fiscal · Verifique as informações e tente novamente. · Informe o peso bruto · Informe o telefone');
  });

  test('the authorize URL carries a state that only its hash is stored for', async () => {
    const store = connection(null);
    const url = new URL(await new BlingClient({ ...options, connection: store }).buildAuthorizeUrl());
    const state = url.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(store.saveState.mock.calls[0][0].stateHash).not.toBe(state);
  });
});

describe('product taxes', () => {
  const item = { code: 'EDEN-3001', description: 'Carne', unitMinor: 7000, ncm: '23091000', origin: 0 };

  test('creates a missing product with the NCM and origin of the catalog', async () => {
    const client = fakeClient({ findProductByCode: jest.fn(async () => null) });
    const { service } = build({ client });
    await service.ensureProduct(item);
    expect(client.createProduct).toHaveBeenCalledWith(expect.objectContaining({
      codigo: 'EDEN-3001',
      tributacao: { origem: 0, ncm: '2309.10.00' }
    }));
  });

  test('does not create a product the catalog has no NCM for', async () => {
    const client = fakeClient({ findProductByCode: jest.fn(async () => null) });
    const { service } = build({ client });
    await expect(service.ensureProduct({ ...item, ncm: null })).rejects.toThrow('has no NCM');
    expect(client.createProduct).not.toHaveBeenCalled();
  });

  test('corrects a product that differs from the catalog and leaves an equal one alone', async () => {
    const differs = fakeClient({ getProduct: jest.fn(async () => ({ tributacao: { ncm: '2309.90.10', origem: 0 } })), updateProduct: jest.fn() });
    await build({ client: differs }).service.ensureProduct(item);
    expect(differs.updateProduct).toHaveBeenCalledWith(20, { tributacao: { origem: 0, ncm: '2309.10.00' } });

    const equal = fakeClient({ getProduct: jest.fn(async () => ({ tributacao: { ncm: '2309.10.00', origem: 0 } })), updateProduct: jest.fn() });
    await build({ client: equal }).service.ensureProduct(item);
    expect(equal.updateProduct).not.toHaveBeenCalled();
  });

  test('uses the variation id as the Bling code', async () => {
    const { service } = build();
    service.variants = { findVariantsByPriceIds: jest.fn(async () => new Map([['price_food', { variationId: 3001, flavorKey: 'beef', grams: 300, ncm: '23091000', origin: 2 }]])) };
    const [line] = await service.invoiceLines({ lines: { data: [{ amount: 100, pricing: { price_details: { product: 'prod_food', price: 'price_food' } } }] } });
    expect(line).toMatchObject({ code: 'EDEN-3001', ncm: '23091000', origin: 2 });
  });
});

describe('listForSubscription (subscription-detail-workflow)', () => {
  function arrangeList() {
    const repository = memoryRepository();
    repository.listBySubscription = jest.fn(async (subscriptionId) => [...repository.rows.values()].filter((row) => row.stripeSubscriptionId === subscriptionId));
    const ledgerRepository = { findById: jest.fn(async () => ({ id: 12, stripeSubscriptionId: 'sub_1', stripeAccount: 'br' })) };
    return { ...build({ repository, ledgerRepository }), repository };
  }

  test('a note blocked for a missing fiscal name says so, with its invoice', async () => {
    const { service, repository } = arrangeList();
    const { id } = await record(service);
    Object.assign(repository.rows.get(id), { status: 'blocked_missing_document', missingFields: ['fiscal_name'] });

    const { data } = await service.listForSubscription('12', {});

    expect(data.items[0]).toMatchObject({
      id,
      stripe_invoice_id: paidInvoice.id,
      missing_fields: ['fiscal_name'],
      bling_problems: []
    });
    expect(data.items[0]).not.toHaveProperty('request_payload');
    expect(data.items[0]).not.toHaveProperty('response_payload');
  });

  test('a note Bling refused lists the fields Bling named, as the detail does', async () => {
    const fields = [{ element: 'itens[0].unidadeTributavel', message: 'Há informações obrigatórias faltando na nota' }];
    const { service, repository } = arrangeList();
    const { id } = await record(service);
    Object.assign(repository.rows.get(id), { status: 'error', responsePayload: { error_detail: { fields } } });

    const { data } = await service.listForSubscription('12', {});

    expect(data.items[0].bling_problems).toEqual(fields);
    expect(data.items[0].bling_problems).toEqual((await service.detail(id)).data.bling_problems);
  });

  test('an authorized note has nothing to fix', async () => {
    const { service, repository } = arrangeList();
    const { id } = await record(service);
    Object.assign(repository.rows.get(id), {
      status: 'authorized',
      missingFields: null,
      responsePayload: { error_detail: { fields: [{ element: 'x', message: 'y' }] } }
    });

    const { data } = await service.listForSubscription('12', {});

    expect(data.items[0]).toMatchObject({ missing_fields: [], bling_problems: [] });
  });
});
