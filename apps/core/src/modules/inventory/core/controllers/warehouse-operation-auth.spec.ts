import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AuthorizationService, ScopeGuard } from '@app/authorization';
import * as request from 'supertest';
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

// Real Nest routes/ScopeGuard/DTO pipeline; replace only the DB authorization source and mutation services.
describe('warehouse v2 HTTP authorization and DTO contract', () => {
  let app: INestApplication;
  const mutation = jest.fn().mockResolvedValue({ lineId: 'line' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        WarehouseWorkContextController,
        InventoryController,
        InboundController,
        MovementController,
        StocktakingController,
      ],
      providers: [
        ScopeGuard,
        {
          provide: AuthorizationService,
          useValue: {
            getScopesByRoles: async (roles: string[]) =>
              new Set(
                roles.includes('manager')
                  ? ['inventory.operate', 'inventory.manage', 'inventory.adjust']
                  : roles.includes('worker')
                    ? ['inventory.operate']
                    : [],
              ),
          },
        },
        { provide: InventoryIdempotencyService, useValue: { withIdempotency: mutation } },
        ...[
          InventoryCommandService,
          StockEventService,
          InboundService,
          InboundPutawayReader,
          MovementService,
          StocktakingService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      if (req.headers['x-test-role'])
        req.user = { userId: '00000000-0000-4000-8000-000000000001', roles: [req.headers['x-test-role']] };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => mutation.mockClear());

  it('exposes authenticated identity to an operator', async () => {
    const response = await request(app.getHttpServer())
      .get('/inventory/work-context')
      .set('x-test-role', 'worker')
      .expect(200);
    expect(response.body).toEqual({
      actorId: '00000000-0000-4000-8000-000000000001',
      operationContractVersion: 2,
      capabilities: { stocktakingAddCountItem: true },
    });
  });
  it('fails closed for anonymous work context and ordinary worker diagnostics', async () => {
    await request(app.getHttpServer()).get('/inventory/work-context').expect(403);
    await request(app.getHttpServer()).get('/inventory/diagnostics-access').set('x-test-role', 'worker').expect(403);
    await request(app.getHttpServer()).get('/inventory/diagnostics-access').set('x-test-role', 'manager').expect(204);
  });
  it.each([
    '/inventory/stocks/adjust',
    '/inbound/simple',
    '/movement/move',
    '/stocktaking/scan-product',
    '/stocktaking/scan-location',
    '/stocktaking/count-items',
  ])('denies unauthorized %s before payload validation/replay', async (path) => {
    await request(app.getHttpServer()).post(path).send({ contractVersion: 2 }).expect(403);
    expect(mutation).not.toHaveBeenCalled();
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
    const res = await request(app.getHttpServer())
      .post('/inventory/stocks/adjust')
      .set('x-test-role', 'manager')
      .set('Idempotency-Key', 'another-operation')
      .send(dto)
      .expect(409);
    expect(res.body).toMatchObject({ code: 'OPERATION_PAYLOAD_MISMATCH', error: 'OPERATION_PAYLOAD_MISMATCH' });
    expect(res.body.message).not.toContain('operation');
    expect(mutation).not.toHaveBeenCalled();
  });
  it('rejects unknown contract versions with an update instruction', async () => {
    const res = await request(app.getHttpServer())
      .post('/inventory/stocks/adjust')
      .set('x-test-role', 'manager')
      .send({ ...dto, contractVersion: 3 })
      .expect(426);
    expect(res.body.code).toBe('CLIENT_UPDATE_REQUIRED');
    expect(mutation).not.toHaveBeenCalled();
  });
  it('v2 manual counts require the reviewed line revision before executing', async () => {
    await request(app.getHttpServer())
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
    await request(app.getHttpServer())
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
    await request(app.getHttpServer())
      .post('/stocktaking/count-items')
      .set('x-test-role', 'worker')
      .send({ ...addCountItem, ...override })
      .expect(400);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('v2 completion requires a preview token before executing', async () => {
    await request(app.getHttpServer())
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
      const res = await request(app.getHttpServer())
        .post('/inventory/stocks/adjust')
        .set('x-test-role', 'manager')
        .send({ ...dto, contractVersion: undefined })
        .expect(426);
      expect(res.body.code).toBe('CLIENT_UPDATE_REQUIRED');
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.WAREHOUSE_REQUIRE_OPERATION_V2;
      else process.env.WAREHOUSE_REQUIRE_OPERATION_V2 = previous;
    }
  });
});
