const { UpsPickupService, allowedPickupDates } = require('../src/services/ups-pickup.service');
const { HttpError } = require('../src/core/http-error');

const MONDAY = new Date('2026-11-09T15:00:00Z');
const shipFrom = { name: 'Eden Bowls', street: '100 Main St', city: 'Boca Raton', state: 'FL', zipcode: '33431', country: 'US', phone: '305 555 0100' };
const admin = { email: 'ops@edenbowls.com', roles: ['admin'], markets: ['US', 'BR'] };
const brazilOnly = { email: 'br@edenbowls.com', roles: ['operator'], markets: ['BR'] };

function setup(overrides = {}) {
  const pickup = { id: 9, pickup_date: '2026-11-09', ready_time: '14:00', close_time: '18:00', package_count: 8, status: 'pending', prn: null, shipment_ids: [1] };
  const repository = {
    reserve: jest.fn().mockResolvedValue({ pickup }),
    markRequested: jest.fn(async (id, { prn }) => ({ ...pickup, status: 'requested', prn })),
    markUnknown: jest.fn().mockResolvedValue({ ...pickup, status: 'unknown' }),
    deleteReservation: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(true),
    findById: jest.fn().mockResolvedValue({ ...pickup, status: 'requested', prn: '2929602E9CP' }),
    list: jest.fn().mockResolvedValue([]),
    ...overrides.repository
  };
  const upsClient = {
    isConfigured: () => true,
    ensureCanShip: jest.fn(),
    createPickup: jest.fn().mockResolvedValue({ prn: '2929602E9CP', raw: {} }),
    cancelPickup: jest.fn().mockResolvedValue({}),
    ...overrides.upsClient
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const calendar = { listActive: jest.fn().mockResolvedValue(overrides.calendarRows || []) };
  const service = new UpsPickupService({
    repository,
    upsClient,
    auditService,
    calendar,
    shipmentRepository: overrides.shipmentRepository,
    shippingService: { settings: { us: { ship_from: overrides.shipFrom || shipFrom, package: { weight_lb: 10 }, allowed_service_codes: ['03'] } } },
    now: () => overrides.now || MONDAY
  });
  return { service, repository, upsClient, auditService };
}

const eight = Array.from({ length: 8 }, (_, index) => index + 1);
const body = (overrides = {}) => ({ pickup_date: '2026-11-09', ready_time: '14:00', close_time: '18:00', package_count: 8, shipment_ids: eight, ...overrides });
const code = (promise) => promise.then(() => null, (error) => error.details && error.details.code);

describe('allowedPickupDates', () => {
  test('Monday allows Monday and Tuesday', () => {
    expect(allowedPickupDates(MONDAY, [])).toEqual(['2026-11-09', '2026-11-10']);
  });

  test('Saturday allows Monday only', () => {
    expect(allowedPickupDates(new Date('2026-11-07T15:00:00Z'), [])).toEqual(['2026-11-09']);
  });

  test('a closesPickup day is skipped', () => {
    const rows = [{ market: 'US', closedOn: '2026-11-10', active: true, closesPickup: true }];
    expect(allowedPickupDates(MONDAY, rows)).toEqual(['2026-11-09', '2026-11-11']);
  });
});

describe('UpsPickupService.request', () => {
  test('Monday with eight boxes: one UPS call, stored as requested and audited', async () => {
    const { service, repository, upsClient, auditService } = setup();

    const result = await service.request({ actor: admin, body: body() });

    expect(repository.reserve).toHaveBeenCalledWith(expect.objectContaining({ pickupDate: '2026-11-09', packageCount: 8, shipmentIds: eight, requestedBy: 'ops@edenbowls.com' }));
    expect(upsClient.createPickup).toHaveBeenCalledTimes(1);
    expect(upsClient.createPickup).toHaveBeenCalledWith(expect.objectContaining({ packageCount: 8, shipFrom, serviceCode: '03', totalWeightLb: 80 }));
    expect(result.data.pickup).toMatchObject({ status: 'requested', prn: '2929602E9CP' });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ups_pickup.request', metadata: expect.objectContaining({ pickupId: 9, prn: '2929602E9CP' }) }));
  });

  test('Two labels with three boxes: UPS receives the 67.6 lb of the packages, with 3 boxes', async () => {
    const shipmentRepository = {
      listPackagesByShipmentIds: jest.fn().mockResolvedValue([
        { shipment_id: 1, sequence: 1, weight_lb: 37.5 },
        { shipment_id: 1, sequence: 2, weight_lb: 20.2 },
        { shipment_id: 2, sequence: 1, weight_lb: 9.9 }
      ])
    };
    const { service, upsClient } = setup({ shipmentRepository });

    await service.request({ actor: admin, body: body({ package_count: 3, shipment_ids: [1, 2] }) });

    expect(shipmentRepository.listPackagesByShipmentIds).toHaveBeenCalledWith([1, 2]);
    expect(upsClient.createPickup).toHaveBeenCalledWith(expect.objectContaining({ packageCount: 3, totalWeightLb: 67.6 }));
  });

  test('a label bought before boxes counts as one settings package', async () => {
    const shipmentRepository = { listPackagesByShipmentIds: jest.fn().mockResolvedValue([{ shipment_id: 1, sequence: 1, weight_lb: 37.5 }]) };
    const { service, upsClient } = setup({ shipmentRepository });

    await service.request({ actor: admin, body: body({ package_count: 2, shipment_ids: [1, 2] }) });

    expect(upsClient.createPickup).toHaveBeenCalledWith(expect.objectContaining({ packageCount: 2, totalWeightLb: 47.5 }));
  });

  test('a count different from the labels is kept', async () => {
    const { service, repository } = setup();
    await service.request({ actor: admin, body: body({ package_count: 14, shipment_ids: Array.from({ length: 15 }, (_, i) => i + 1) }) });
    expect(repository.reserve).toHaveBeenCalledWith(expect.objectContaining({ packageCount: 14 }));
  });

  test('a label already in a pickup or voided is refused without calling UPS', async () => {
    const { service, upsClient } = setup({ repository: { reserve: jest.fn().mockResolvedValue({ pickup: null, ineligibleIds: [3] }) } });
    const error = await service.request({ actor: admin, body: body() }).catch((caught) => caught);
    expect(error.statusCode).toBe(422);
    expect(error.details).toEqual({ code: 'pickup_shipment_not_eligible', shipment_ids: [3] });
    expect(upsClient.createPickup).not.toHaveBeenCalled();
  });

  test.each([
    ['no labels', body({ shipment_ids: [] }), 'pickup_shipments_required'],
    ['count 0', body({ package_count: 0 }), 'pickup_count_invalid'],
    ['window backwards', body({ ready_time: '18:00', close_time: '14:00' }), 'pickup_window_invalid'],
    ['bad time', body({ ready_time: '2pm' }), 'pickup_window_invalid'],
    ['Saturday', body({ pickup_date: '2026-11-14' }), 'pickup_date_not_allowed'],
    ['two days ahead', body({ pickup_date: '2026-11-11' }), 'pickup_date_not_allowed']
  ])('%s is refused before UPS', async (_label, payload, expected) => {
    const { service, upsClient, repository } = setup();
    expect(await code(service.request({ actor: admin, body: payload }))).toBe(expected);
    expect(repository.reserve).not.toHaveBeenCalled();
    expect(upsClient.createPickup).not.toHaveBeenCalled();
  });

  test('a closed day is refused', async () => {
    const { service } = setup({ calendarRows: [{ market: 'US', closedOn: '2026-11-09', active: true, closesPickup: true }] });
    expect(await code(service.request({ actor: admin, body: body() }))).toBe('pickup_date_not_allowed');
  });

  test.each([
    ['no phone', { phone: '' }, ['phone']],
    ['a short phone', { phone: '555 0100' }, ['phone']],
    ['no street nor phone', { street: '', phone: '' }, ['street', 'phone']]
  ])('%s is pickup_ship_from_incomplete naming what is missing', async (_label, change, missing) => {
    const { service, upsClient } = setup({ shipFrom: { ...shipFrom, ...change } });
    const error = await service.request({ actor: admin, body: body() }).catch((caught) => caught);
    expect(error.details).toEqual({ code: 'pickup_ship_from_incomplete', missing });
    expect(upsClient.createPickup).not.toHaveBeenCalled();
  });

  test('a timeout leaves the pickup unknown with its labels', async () => {
    const timeout = new HttpError(504, 'UPS request timed out.', { code: 'ups_timeout' });
    timeout.upsTimeout = true;
    const { service, repository, auditService } = setup({ upsClient: { createPickup: jest.fn().mockRejectedValue(timeout) } });

    const error = await service.request({ actor: admin, body: body() }).catch((caught) => caught);

    expect(error.statusCode).toBe(502);
    expect(error.details).toEqual({ code: 'pickup_unconfirmed', pickup_id: 9 });
    expect(repository.markUnknown).toHaveBeenCalledWith(9, 'ups_timeout');
    expect(repository.deleteReservation).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ups_pickup.unconfirmed' }));
  });

  test('a UPS refusal stores nothing and passes the UPS message', async () => {
    const refusal = new HttpError(502, 'Invalid pickup address', { code: 'ups_upstream_error', status: 400 });
    const { service, repository } = setup({ upsClient: { createPickup: jest.fn().mockRejectedValue(refusal) } });

    await expect(service.request({ actor: admin, body: body() })).rejects.toBe(refusal);
    expect(repository.deleteReservation).toHaveBeenCalledWith(9);
    expect(repository.markUnknown).not.toHaveBeenCalled();
  });

  test('a Brazil operator cannot request', async () => {
    const { service, repository } = setup();
    expect(await code(service.request({ actor: brazilOnly, body: body() }))).toBe('pickup_shipment_not_eligible');
    expect(repository.reserve).not.toHaveBeenCalled();
  });

  test('the simulation client refuses', async () => {
    const { service } = setup({
      upsClient: { ensureCanShip: () => { throw new HttpError(409, 'sim', { code: 'ups_simulation_only' }); } }
    });
    expect(await code(service.request({ actor: admin, body: body() }))).toBe('ups_simulation_only');
  });
});

describe('UpsPickupService cancel and not-created', () => {
  test('cancel calls UPS with the PRN, closes and audits', async () => {
    const { service, repository, upsClient, auditService } = setup();
    await service.cancel(9, admin);
    expect(upsClient.cancelPickup).toHaveBeenCalledWith('2929602E9CP');
    expect(repository.close).toHaveBeenCalledWith(9, { fromStatus: 'requested', toStatus: 'canceled', closedBy: 'ops@edenbowls.com' });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ups_pickup.cancel' }));
  });

  test('a canceled pickup is 409 and UPS is not called', async () => {
    const { service, upsClient } = setup({ repository: { findById: jest.fn().mockResolvedValue({ id: 9, status: 'canceled' }) } });
    expect(await code(service.cancel(9, admin))).toBe('pickup_not_cancelable');
    expect(upsClient.cancelPickup).not.toHaveBeenCalled();
  });

  test('a UPS refusal on cancel keeps the pickup requested', async () => {
    const refusal = new HttpError(502, 'Cannot cancel', { code: 'ups_upstream_error', status: 400 });
    const { service, repository } = setup({ upsClient: { cancelPickup: jest.fn().mockRejectedValue(refusal) } });
    await expect(service.cancel(9, admin)).rejects.toBe(refusal);
    expect(repository.close).not.toHaveBeenCalled();
  });

  test('not-created closes an unknown pickup without UPS', async () => {
    const { service, repository, upsClient, auditService } = setup({ repository: { findById: jest.fn().mockResolvedValue({ id: 9, status: 'unknown' }) } });
    await service.markNotCreated(9, admin);
    expect(repository.close).toHaveBeenCalledWith(9, expect.objectContaining({ fromStatus: 'unknown', toStatus: 'not_created', closedBy: 'ops@edenbowls.com' }));
    expect(upsClient.cancelPickup).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ups_pickup.not_created' }));
  });

  test('a reservation left pending for 10 minutes is unknown and closes as not created', async () => {
    const { service, repository } = setup({
      repository: { findById: jest.fn().mockResolvedValue({ id: 9, status: 'pending', created_at: new Date(MONDAY.getTime() - 10 * 60 * 1000) }) }
    });
    await service.markNotCreated(9, admin);
    expect(repository.close).toHaveBeenCalledWith(9, expect.objectContaining({
      fromStatus: 'unknown',
      toStatus: 'not_created',
      pendingBefore: new Date(MONDAY.getTime() - 5 * 60 * 1000)
    }));
  });

  test('a request in progress (pending 30 seconds) is 409 pickup_not_unknown', async () => {
    const { service, repository } = setup({
      repository: { findById: jest.fn().mockResolvedValue({ id: 9, status: 'pending', created_at: new Date(MONDAY.getTime() - 30 * 1000) }) }
    });
    expect(await code(service.markNotCreated(9, admin))).toBe('pickup_not_unknown');
    expect(repository.close).not.toHaveBeenCalled();
  });

  test('not-created on a requested pickup is 409', async () => {
    const { service } = setup();
    expect(await code(service.markNotCreated(9, admin))).toBe('pickup_not_unknown');
  });

  test('a Brazil operator gets 404', async () => {
    const { service } = setup();
    expect(await code(service.cancel(9, brazilOnly))).toBe('pickup_not_found');
  });
});

describe('UpsPickupService.list', () => {
  test('defaults to 7 days ago in New York', async () => {
    const { service, repository } = setup();
    const result = await service.list(admin, {});
    expect(repository.list).toHaveBeenCalledWith({ from: '2026-11-02' });
    expect(result.data.from).toBe('2026-11-02');
  });

  test('shows a left-behind reservation as unknown and a fresh one as pending', async () => {
    const { service } = setup({
      repository: {
        list: jest.fn().mockResolvedValue([
          { id: 1, status: 'pending', created_at: new Date(MONDAY.getTime() - 10 * 60 * 1000) },
          { id: 2, status: 'pending', created_at: new Date(MONDAY.getTime() - 10 * 1000) }
        ])
      }
    });
    const result = await service.list(admin, {});
    expect(result.data.items.map((item) => item.status)).toEqual(['unknown', 'pending']);
  });

  test('passes from', async () => {
    const { service, repository } = setup();
    await service.list(admin, { from: '2026-10-01' });
    expect(repository.list).toHaveBeenCalledWith({ from: '2026-10-01' });
  });

  test('a Brazil operator gets an empty list', async () => {
    const { service, repository } = setup();
    const result = await service.list(brazilOnly, {});
    expect(result.data.items).toEqual([]);
    expect(repository.list).not.toHaveBeenCalled();
  });
});
