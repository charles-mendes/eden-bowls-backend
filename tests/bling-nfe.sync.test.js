const { BlingNfeService } = require('../src/services/bling-nfe.service');
const { BlingNotConnectedError } = require('../src/infrastructure/bling/bling-client');
const { JOB_INTERVALS, LOCKS, createJobDefinitions } = require('../src/services/background-jobs.service');
const { nfeStatusFromSituacao } = require('../src/core/nfe');

const NOW = new Date('2026-11-02T17:00:00Z');

function fullNote(overrides = {}) {
  return {
    id: 40,
    situacao: 1,
    numero: '000001',
    serie: 1,
    chaveAcesso: '',
    valorNota: 199,
    dataEmissao: '2026-11-02 13:54:20',
    numeroPedidoLoja: 'in_test_002',
    contato: {
      id: 7,
      nome: 'Cliente Teste',
      email: 'teste@example.com',
      numeroDocumento: '529.982.247-25',
      endereco: { endereco: 'Avenida Paulista', numero: '1000', bairro: 'Bela Vista', cep: '01310100', municipio: 'São Paulo', uf: 'SP' }
    },
    ...overrides
  };
}

function fakeRepository(seed = []) {
  const rows = new Map(seed.map((row) => [row.id, row]));
  let nextId = 100;
  const all = () => [...rows.values()];
  return {
    rows,
    findById: jest.fn(async (id) => rows.get(id) || null),
    findByStripeInvoice: jest.fn(async (account, invoiceId) => all().find((row) => row.stripeInvoiceId === invoiceId) || null),
    findByBlingNfeIds: jest.fn(async (ids) => new Map(all().filter((row) => ids.includes(row.blingNfeId)).map((row) => [row.blingNfeId, row]))),
    insertOrGet: jest.fn(async (input) => {
      const row = { id: nextId, attempts: 0, blingNfeId: null, ...input };
      rows.set(nextId, row);
      nextId += 1;
      return row;
    }),
    update: jest.fn(async (id, patch) => { Object.assign(rows.get(id), patch); }),
    requeue: jest.fn(),
    listDue: jest.fn(async () => all().filter((row) => row.nextAttemptAt))
  };
}

function fakeClient(overrides = {}) {
  return {
    isConfigured: () => true,
    keepAlive: jest.fn(async () => {}),
    listNfes: jest.fn(async () => [{ id: 40, situacao: 1 }]),
    getNfe: jest.fn(async () => fullNote()),
    sendNfe: jest.fn(),
    ...overrides
  };
}

function build({ client = fakeClient(), repository = fakeRepository() } = {}) {
  return {
    client,
    repository,
    service: new BlingNfeService({ client, repository, naturezaOperacaoId: 1, now: () => NOW })
  };
}

function ownRow(overrides = {}) {
  return { id: 1, status: 'submitted', stripeInvoiceId: 'in_1', blingNfeId: 40, blingSituacao: 3, attempts: 1, ...overrides };
}

describe('BlingNfeService.syncFromBling', () => {
  test('asks Bling for outgoing notes of the last 90 days only', async () => {
    const { service, client } = build();
    await service.syncFromBling();
    expect(client.listNfes).toHaveBeenCalledWith({ pagina: 1, limite: 100, tipo: 1, dataEmissaoInicial: '2026-08-04' });
  });

  test('walks the pages until a short one', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ id: 1000 + index, situacao: 1 }));
    const client = fakeClient({ listNfes: jest.fn().mockResolvedValueOnce(page).mockResolvedValueOnce([]) });
    const { service } = build({ client });
    await service.syncFromBling();
    expect(client.listNfes).toHaveBeenCalledTimes(2);
  });

  test('skips quietly while Bling is not configured or not connected', async () => {
    const notConfigured = build({ client: fakeClient({ isConfigured: () => false }) });
    await expect(notConfigured.service.syncFromBling()).resolves.toEqual({ skipped: true });

    const client = fakeClient({ listNfes: jest.fn(async () => { throw new BlingNotConnectedError(); }) });
    await expect(build({ client }).service.syncFromBling()).resolves.toEqual({ skipped: true, reason: 'bling_not_connected' });
  });

  test('a note that did not change costs no extra call', async () => {
    const repository = fakeRepository([ownRow({ blingSituacao: 1 })]);
    const { service, client } = build({ repository });
    await expect(service.syncFromBling()).resolves.toEqual({ scanned: 1, updated: 0, imported: 0, failed: 0 });
    expect(client.getNfe).not.toHaveBeenCalled();
  });

  test('picks up an authorization that happened in Bling', async () => {
    const repository = fakeRepository([ownRow()]);
    const client = fakeClient({
      listNfes: jest.fn(async () => [{ id: 40, situacao: 5 }]),
      getNfe: jest.fn(async () => fullNote({ situacao: 5, chaveAcesso: '3526', linkDanfe: 'https://bling/danfe', xml: 'https://bling/xml' }))
    });
    const { service } = build({ client, repository });
    await service.syncFromBling();
    expect(repository.rows.get(1)).toMatchObject({
      status: 'authorized', blingSituacao: 5, accessKey: '3526', danfeUrl: 'https://bling/danfe', xmlUrl: 'https://bling/xml', authorizedAt: NOW, nextAttemptAt: null
    });
  });

  test('picks up a cancellation of an authorized note and never offers a retry', async () => {
    const repository = fakeRepository([ownRow({ status: 'authorized', blingSituacao: 5 })]);
    const client = fakeClient({ listNfes: jest.fn(async () => [{ id: 40, situacao: 2 }]), getNfe: jest.fn(async () => fullNote({ situacao: 2 })) });
    const { service } = build({ client, repository });
    await service.syncFromBling();
    expect(repository.rows.get(1)).toMatchObject({ status: 'canceled', blingSituacao: 2, nextAttemptAt: null });
    await expect(service.retry(1, {})).rejects.toMatchObject({ details: { code: 'nfe_not_retryable' } });
  });

  test('a note of ours waiting for a retry stays in its queue while Bling still has the draft', async () => {
    const nextAttemptAt = new Date('2026-11-02T18:00:00Z');
    const repository = fakeRepository([ownRow({ status: 'error', blingSituacao: null, nextAttemptAt })]);
    const { service, client } = build({ repository });
    await service.syncFromBling();
    expect(repository.rows.get(1)).toMatchObject({ status: 'error', blingSituacao: 1, nextAttemptAt });
    expect(client.getNfe).not.toHaveBeenCalled();
  });

  test('never sends anything', async () => {
    const repository = fakeRepository([ownRow({ blingNfeId: 41, blingSituacao: 3 })]);
    const client = fakeClient({ listNfes: jest.fn(async () => [{ id: 40, situacao: 1 }, { id: 41, situacao: 4 }]) });
    const { service } = build({ client, repository });
    await service.syncFromBling();
    expect(client.sendNfe).not.toHaveBeenCalled();
  });

  test('one bad note does not stop the others', async () => {
    const repository = fakeRepository([ownRow()]);
    const client = fakeClient({
      listNfes: jest.fn(async () => [{ id: 39, situacao: 1 }, { id: 40, situacao: 5 }]),
      getNfe: jest.fn(async (id) => {
        if (id === 39) throw new Error('boom');
        return fullNote({ situacao: 5 });
      })
    });
    const { service } = build({ client, repository });
    await expect(service.syncFromBling()).resolves.toMatchObject({ updated: 1, failed: 1 });
  });
});

describe('notes that exist only in Bling', () => {
  async function imported(note = fullNote()) {
    const context = build({ client: fakeClient({ getNfe: jest.fn(async () => note), listNfes: jest.fn(async () => [{ id: 40, situacao: note.situacao }]) }) });
    await context.service.syncFromBling();
    return { ...context, row: context.repository.rows.get(100) };
  }

  test('are stored with what Bling shows', async () => {
    const { row } = await imported();
    expect(row).toMatchObject({
      stripeAccount: 'br',
      stripeInvoiceId: 'bling:40',
      blingNfeId: 40,
      blingContactId: 7,
      blingSituacao: 1,
      nfeNumber: '000001',
      nfeSeries: '1',
      totalMinor: 19900,
      currency: 'brl',
      customerName: 'Cliente Teste',
      customerDocument: '52998224725',
      status: 'pending',
      nextAttemptAt: null,
      userId: null
    });
    expect(row.customerAddress).toMatchObject({ street: 'Avenida Paulista', city: 'São Paulo', state: 'SP' });
    expect(row.createdAt.toISOString()).toBe('2026-11-02T16:54:20.000Z');
  });

  test('never enter the sending queue, even as a draft', async () => {
    const { service, client, repository } = await imported();
    await expect(repository.listDue()).resolves.toEqual([]);
    await service.runDue();
    expect(client.sendNfe).not.toHaveBeenCalled();
  });

  test('stay out of the queue while on their way at SEFAZ', async () => {
    const { repository } = await imported(fullNote({ situacao: 3 }));
    expect(repository.rows.get(100)).toMatchObject({ status: 'submitted', nextAttemptAt: null });
  });

  test('cannot be retried, even when rejected', async () => {
    const { service, repository } = await imported(fullNote({ situacao: 4 }));
    expect(repository.rows.get(100).status).toBe('rejected');
    await expect(service.retry(100, {})).rejects.toMatchObject({ details: { code: 'nfe_not_retryable' } });
    expect(repository.requeue).not.toHaveBeenCalled();
    const { data } = await service.detail(100, {});
    expect(data).toMatchObject({ imported: true, can_retry: false, bling_situacao_label: 'Rejeitada' });
  });

  test('are not imported twice', async () => {
    const { service, repository } = await imported();
    await expect(service.syncFromBling()).resolves.toMatchObject({ imported: 0 });
    expect(repository.insertOrGet).toHaveBeenCalledTimes(1);
  });

  test('a note generated by a row of ours that lost the answer is left for that row', async () => {
    const repository = fakeRepository([ownRow({ stripeInvoiceId: 'in_test_002', blingNfeId: null, status: 'error' })]);
    const { service } = build({ repository });
    await expect(service.syncFromBling()).resolves.toMatchObject({ imported: 0 });
    expect(repository.insertOrGet).not.toHaveBeenCalled();
  });
});

describe('status and job wiring', () => {
  test('a canceled note has its own status', () => {
    expect(nfeStatusFromSituacao(2)).toBe('canceled');
    expect(nfeStatusFromSituacao(4)).toBe('rejected');
  });

  test('the sync shares the lock of the emission job, so a rotating token has one owner', () => {
    const job = createJobDefinitions({ cursorRepository: {} }).find((item) => item.name === 'bling_nfe_sync');
    expect(job.lockName).toBe(LOCKS.bling_nfe);
    expect(JOB_INTERVALS.bling_nfe_sync).toBe(5 * 60 * 1000);
  });

  test('the job runs the sync', async () => {
    const blingNfeService = { syncFromBling: jest.fn(async () => ({ scanned: 0 })) };
    const job = createJobDefinitions({ blingNfeService, cursorRepository: {} }).find((item) => item.name === 'bling_nfe_sync');
    await job.run();
    expect(blingNfeService.syncFromBling).toHaveBeenCalled();
  });
});
