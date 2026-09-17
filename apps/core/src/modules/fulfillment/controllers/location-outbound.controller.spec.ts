import { Server } from 'http';
import { Request } from 'express';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AuthorizationService, ScopeGuard } from '@app/authorization';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { GlobalExceptionFilter } from '@app/shared/filters/http-exception.filter';
import { LocationOutboundController } from './location-outbound.controller';
import { LocationOutboundService } from '../services/location-outbound.service';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';

describe('location outbound HTTP authorization and validation', () => {
  let app: INestApplication;
  const mutation = jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue({ sources: [], status: 'in_progress' });
  const warehouseId = randomUUID();
  const shipmentId = randomUUID();
  const sourceLocationId = randomUUID();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LocationOutboundController],
      providers: [
        ScopeGuard,
        {
          provide: AuthorizationService,
          useValue: {
            getScopesByRoles: (roles: string[]) =>
              Promise.resolve(
                new Set(
                  roles.includes('manager')
                    ? [FULFILLMENT_SCOPE.WAREHOUSE_OPERATE, FULFILLMENT_SCOPE.DISPATCH_FORCE]
                    : roles.includes('worker')
                      ? [FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]
                      : [],
                ),
              ),
          },
        },
        {
          provide: LocationOutboundService,
          useValue: { start: mutation, getState: mutation, scan: mutation, force: mutation, resolveForce: mutation },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: Request & { user?: { userId: string; roles: string[] } }, _res: unknown, next: () => void) => {
      const role = req.headers['x-test-role'];
      if (typeof role === 'string') req.user = { userId: randomUUID(), roles: [role] };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => mutation.mockClear());
  it.each(['starts', 'scans', 'forces', 'force-resolutions'])('requires authenticated scope for %s', async (suffix) => {
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-${suffix}`)
      .send({})
      .expect(403);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('allows warehouse operators to resolve the original force body and key', async () => {
    const body = {
      warehouseId,
      reason: 'confirmed',
      items: [{ shipmentLineId: randomUUID(), sourceLocationId, quantity: 1 }],
    };
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-force-resolutions`)
      .set('x-test-role', 'worker')
      .set('Idempotency-Key', 'original-force')
      .send(body)
      .expect(201);
    expect(mutation).toHaveBeenCalledWith(
      shipmentId,
      body,
      expect.objectContaining({ roles: ['worker'] }),
      'original-force',
    );
  });
  it.each([
    { reason: '', items: [] },
    { reason: 'checked', items: [{ shipmentLineId: 'bad', sourceLocationId, quantity: 0 }] },
  ])('validates original force resolution body %s', async (body) => {
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-force-resolutions`)
      .set('x-test-role', 'worker')
      .set('Idempotency-Key', 'original-force')
      .send({ warehouseId, ...body })
      .expect(400);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('requires the original key and rejects a role that lost warehouse permission', async () => {
    const path = `/shipments/${shipmentId}/location-outbound-force-resolutions`;
    await request(app.getHttpServer() as Server)
      .post(path)
      .set('x-test-role', 'worker')
      .send({ warehouseId, reason: 'confirmed', items: [] })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post(path)
      .set('x-test-role', 'former-worker')
      .set('Idempotency-Key', 'original-force')
      .send({ warehouseId, reason: 'confirmed', items: [] })
      .expect(403);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('requires the force scope before executing', async () => {
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-forces`)
      .set('x-test-role', 'worker')
      .send({})
      .expect(403);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('requires a UUID warehouse on state and mutation, and an idempotency key on start', async () => {
    await request(app.getHttpServer() as Server)
      .get(`/shipments/${shipmentId}/location-outbound-state`)
      .set('x-test-role', 'worker')
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-starts`)
      .set('x-test-role', 'worker')
      .set('Idempotency-Key', randomUUID())
      .send({ warehouseId: 'wrong' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-starts`)
      .set('x-test-role', 'worker')
      .send({ warehouseId })
      .expect(400);
    expect(mutation).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 2147483648])('rejects invalid scan quantity %s', async (quantity) => {
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-scans`)
      .set('x-test-role', 'worker')
      .set('Idempotency-Key', randomUUID())
      .send({ warehouseId, sourceLocationId, barcode: 'sku', quantity })
      .expect(400);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('validates nested force items', async () => {
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-forces`)
      .set('x-test-role', 'manager')
      .set('Idempotency-Key', randomUUID())
      .send({ warehouseId, reason: 'confirmed', items: [{ shipmentLineId: 'bad', sourceLocationId, quantity: 0 }] })
      .expect(400);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('wires all four routes and forwards the force authorization decision', async () => {
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-starts`)
      .set('x-test-role', 'worker')
      .set('Idempotency-Key', randomUUID())
      .send({ warehouseId })
      .expect(201);
    await request(app.getHttpServer() as Server)
      .get(`/shipments/${shipmentId}/location-outbound-state`)
      .query({ warehouseId })
      .set('x-test-role', 'worker')
      .expect(200);
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-scans`)
      .set('x-test-role', 'worker')
      .set('Idempotency-Key', randomUUID())
      .send({ warehouseId, sourceLocationId, barcode: 'sku', quantity: 1 })
      .expect(201);
    await request(app.getHttpServer() as Server)
      .post(`/shipments/${shipmentId}/location-outbound-forces`)
      .set('x-test-role', 'manager')
      .set('Idempotency-Key', randomUUID())
      .send({ warehouseId, reason: 'confirmed', items: [] })
      .expect(201);
    expect(mutation.mock.calls[3][4]).toMatchObject({ scope: FULFILLMENT_SCOPE.DISPATCH_FORCE, granted: true });
  });
});
