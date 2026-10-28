import { InboundReceiptStateReader } from '../../inbound/services/inbound-receipt-state.reader';
import { Server } from 'http';
import { Request } from 'express';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { enforcedPermissionProvidersForTesting, FIRST_GRANT_ROLE_PERMISSIONS } from '@app/authorization';
import * as request from 'supertest';
import { LocationOutboundController } from '../../../fulfillment/controllers/location-outbound.controller';
import { LocationOutboundService } from '../../../fulfillment/services/location-outbound.service';
import { WarehouseWorkContextController } from './warehouse-work-context.controller';
import { InventoryController } from './inventory.controller';
import { InventoryCommandService } from '../services/inventory-command.service';
import { StockEventService } from '../services/stock-event.service';
import { InventoryIdempotencyService } from '../services/inventory-idempotency.service';
import { GlobalExceptionFilter } from '@app/shared/filters/http-exception.filter';
import { InboundController } from '../../inbound/controllers/inbound.controllers';
import { InboundService } from '../../inbound/services/inbound.service';
import { InboundPutawayReader } from '../../inbound/services/inbound-putaway.reader';
import { MovementController } from '../../movement/controllers/movement.controller';
import { MovementService } from '../../movement/services/movement.service';
import { StocktakingController } from '../../stocktaking/controllers/stocktaking.controller';
import { StocktakingService } from '../../stocktaking/services/stocktaking.service';

// Real Nest routes/PermissionGuard/DTO pipeline; replace only the permission source and mutation services.
describe('warehouse v2 HTTP authorization and DTO contract', () => {
  let app: INestApplication;
  const mutation = jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue({ lineId: 'line' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        WarehouseWorkContextController,
        LocationOutboundController,
        InventoryController,
        InboundController,
        MovementController,
        StocktakingController,
      ],
      providers: [
        // 라이브 enforce 와 같은 인가 — 권한 라우트는 새 판정이 정한다.
        ...enforcedPermissionProvidersForTesting({
          ...FIRST_GRANT_ROLE_PERMISSIONS,
          worker: ['inventory.stock.read', 'inventory.stock.operate'],
          station_worker: [
            'inventory.stock.read',
            'inventory.stock.operate',
            'fulfillment.dispatch.station_force',
            'fulfillment.shipment.short_pick',
          ],
          manager: [
            'inventory.stock.read',
            'inventory.stock.operate',
            'inventory.stock.adjust',
            'inventory.master.read',
            'inventory.master.write',
            'fulfillment.dispatch.force',
          ],
          custom_force: ['inventory.stock.read', 'inventory.stock.operate', 'fulfillment.dispatch.force'],
          mapped_master: FIRST_GRANT_ROLE_PERMISSIONS.master,
        }),
        { provide: LocationOutboundService, useValue: { force: mutation } },
        { provide: InventoryIdempotencyService, useValue: { withIdempotency: mutation } },
        ...[
          InventoryCommandService,
          StockEventService,
          InboundService,
          InboundPutawayReader,
          InboundReceiptStateReader,
          MovementService,
          StocktakingService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: Request & { user?: { userId: string; roles: string[] } }, _res: unknown, next: () => void) => {
      const role = req.headers['x-test-role'];
      if (typeof role === 'string') req.user = { userId: '00000000-0000-4000-8000-000000000001', roles: [role] };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => mutation.mockClear());

  it('exposes authenticated identity to an operator', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/inventory/work-context')
      .set('x-test-role', 'worker')
      .expect(200);
    expect(response.body).toEqual({
      actorId: '00000000-0000-4000-8000-000000000001',
      operationContractVersion: 2,
      capabilities: { stocktakingAddCountItem: true, locationOutbound: true, inboundWorkflowConsistency: true },
      permissions: { forceDispatch: false, stationForceDispatch: false, shortPick: false },
    });
  });
  it.each([
    ['worker', { forceDispatch: false, stationForceDispatch: false, shortPick: false }],
    ['station_worker', { forceDispatch: false, stationForceDispatch: true, shortPick: true }],
    ['manager', { forceDispatch: true, stationForceDispatch: true, shortPick: false }],
    ['custom_force', { forceDispatch: true, stationForceDispatch: true, shortPick: false }],
    ['master', { forceDispatch: true, stationForceDispatch: true, shortPick: true }],
    ['mapped_master', { forceDispatch: true, stationForceDispatch: true, shortPick: true }],
  ])('matches the actual force guard for %s', async (role, permissions) => {
    const context = await request(app.getHttpServer() as Server)
      .get('/inventory/work-context')
      .set('x-test-role', role)
      .expect(200);
    expect(context.body).toHaveProperty('permissions', permissions);
    await request(app.getHttpServer() as Server)
      .post('/shipments/00000000-0000-4000-8000-000000000002/location-outbound-forces')
      .set('x-test-role', role)
      .set('Idempotency-Key', 'check-force')
      .send({ warehouseId: '00000000-0000-4000-8000-000000000003', reason: 'checked', items: [] })
      .expect(permissions.forceDispatch ? 201 : 403);
  });
  it('decides preview and force by permission', async () => {
    const context = await request(app.getHttpServer() as Server)
      .get('/inventory/work-context')
      .set('x-test-role', 'manager')
      .expect(200);
    expect(context.body).toHaveProperty('permissions', { forceDispatch: true, stationForceDispatch: true, shortPick: false });
    await request(app.getHttpServer() as Server)
      .post('/shipments/00000000-0000-4000-8000-000000000002/location-outbound-forces')
      .set('x-test-role', 'manager')
      .send({})
      .expect(400);
    expect(mutation).not.toHaveBeenCalled();
    await request(app.getHttpServer() as Server)
      .post('/shipments/00000000-0000-4000-8000-000000000002/location-outbound-forces')
      .set('x-test-role', 'manager')
      .set('Idempotency-Key', 'lookup-down-force')
      .send({ warehouseId: '00000000-0000-4000-8000-000000000003', reason: 'checked', items: [] })
      .expect(201);
    expect(mutation).toHaveBeenCalledTimes(1);
  });
  it('fails closed for anonymous work context and ordinary worker diagnostics', async () => {
    await request(app.getHttpServer() as Server)
      .get('/inventory/work-context')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get('/inventory/diagnostics-access')
      .set('x-test-role', 'worker')
      .expect(403);
    await request(app.getHttpServer() as Server)
      .get('/inventory/diagnostics-access')
      .set('x-test-role', 'manager')
      .expect(204);
  });
  it.each([
    '/inventory/stocks/adjust',
    '/inbound/simple',
    '/movement/move',
    '/stocktaking/scan-product',
    '/stocktaking/scan-location',
    '/stocktaking/count-items',
  ])('denies an anonymous %s before payload validation/replay', async (path) => {
    await request(app.getHttpServer() as Server)
      .post(path)
      .send({ contractVersion: 2 })
      .expect(401);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('denies a worker without the adjust permission before payload validation/replay', async () => {
    await request(app.getHttpServer() as Server)
      .post('/inventory/stocks/adjust')
      .set('x-test-role', 'worker')
      .send({ contractVersion: 2 })
      .expect(403);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('denies anonymous current receipt state before lookup', async () => {
    await request(app.getHttpServer() as Server)
      .get('/inbound/lines/00000000-0000-4000-8000-000000000002/state?warehouseId=00000000-0000-4000-8000-000000000003')
      .expect(401);
  });
  const dto = {
    contractVersion: 2,
    idempotencyKey: 'operation',
    skuId: '00000000-0000-4000-8000-000000000002',
    warehouseId: '00000000-0000-4000-8000-000000000003',
    delta: 1,
    reason: 'found',
  };
  it('rejects mismatched header/body key without a mutation and exposes a stable code', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/inventory/stocks/adjust')
      .set('x-test-role', 'manager')
      .set('Idempotency-Key', 'another-operation')
      .send(dto)
      .expect(409);
    expect(res.body).toMatchObject({ code: 'OPERATION_PAYLOAD_MISMATCH', error: 'OPERATION_PAYLOAD_MISMATCH' });
    expect(res.body).not.toHaveProperty('message', expect.stringContaining('operation'));
    expect(mutation).not.toHaveBeenCalled();
  });
  it('rejects unknown contract versions with an update instruction', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/inventory/stocks/adjust')
      .set('x-test-role', 'manager')
      .send({ ...dto, contractVersion: 3 })
      .expect(426);
    expect(res.body).toMatchObject({ code: 'CLIENT_UPDATE_REQUIRED' });
    expect(mutation).not.toHaveBeenCalled();
  });
  it('v2 manual counts require the reviewed line revision before executing', async () => {
    await request(app.getHttpServer() as Server)
      .put('/stocktaking/lines/00000000-0000-4000-8000-000000000001/count')
      .set('x-test-role', 'worker')
      .send({ contractVersion: 2, idempotencyKey: 'count-operation', countedQuantity: 0 })
      .expect(400);
    expect(mutation).not.toHaveBeenCalled();
  });
  const addCountItem = {
    sessionId: '00000000-0000-4000-8000-000000000002',
    locationId: '00000000-0000-4000-8000-000000000003',
    skuId: '00000000-0000-4000-8000-000000000004',
    countedQuantity: 0,
    contractVersion: 2,
    idempotencyKey: 'add-count-item',
  };
  it('authorizes an operator and executes SKU-based count creation with actor-bound v2 idempotency', async () => {
    await request(app.getHttpServer() as Server)
      .post('/stocktaking/count-items')
      .set('x-test-role', 'worker')
      .send(addCountItem)
      .expect(200);
    expect(mutation).toHaveBeenCalledWith(
      'stocktaking.add-count-item.v2',
      'add-count-item',
      {
        actorId: '00000000-0000-4000-8000-000000000001',
        countedQuantity: 0,
        locationId: '00000000-0000-4000-8000-000000000003',
        sessionId: '00000000-0000-4000-8000-000000000002',
        skuId: '00000000-0000-4000-8000-000000000004',
      },
      expect.any(Function),
    );
  });
  it.each([
    ['negative total', { countedQuantity: -1 }],
    ['fractional total', { countedQuantity: 1.5 }],
    ['unsafe integer total', { countedQuantity: Number.MAX_SAFE_INTEGER + 1 }],
    ['malformed SKU id', { skuId: 'not-a-uuid' }],
    ['legacy contract', { contractVersion: 1 }],
  ])('rejects %s before executing SKU-based count creation', async (_label, override) => {
    await request(app.getHttpServer() as Server)
      .post('/stocktaking/count-items')
      .set('x-test-role', 'worker')
      .send({ ...addCountItem, ...override })
      .expect(400);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('v2 completion requires a preview token before executing', async () => {
    await request(app.getHttpServer() as Server)
      .post('/stocktaking/sessions/00000000-0000-4000-8000-000000000001/complete')
      .set('x-test-role', 'manager')
      .send({ contractVersion: 2, idempotencyKey: 'complete-operation' })
      .expect(400);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('the rollout gate blocks legacy mutations with an update instruction before replay', async () => {
    const previous = process.env.WAREHOUSE_REQUIRE_OPERATION_V2;
    process.env.WAREHOUSE_REQUIRE_OPERATION_V2 = 'true';
    try {
      const res = await request(app.getHttpServer() as Server)
        .post('/inventory/stocks/adjust')
        .set('x-test-role', 'manager')
        .send({ ...dto, contractVersion: undefined })
        .expect(426);
      expect(res.body).toMatchObject({ code: 'CLIENT_UPDATE_REQUIRED' });
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.WAREHOUSE_REQUIRE_OPERATION_V2;
      else process.env.WAREHOUSE_REQUIRE_OPERATION_V2 = previous;
    }
  });
});
