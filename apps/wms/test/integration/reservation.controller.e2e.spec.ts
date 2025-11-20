import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import type { Test as SupertestTest } from 'supertest';
import { InventoryModule } from '../../src/inventory/inventory.module';
import { SharedModule } from '../../src/shared/shared.module';
import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';

describe('ReservationController - E2E Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await WmsTestDatabase.setup();

    process.env.DATABASE_URL = WmsTestDatabase.getConnectionString();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [InventoryModule, SharedModule],
    })
      .overrideProvider(DbService)
      .useValue({
        db: WmsTestDatabase.getDb(),
      })
      .compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATABASE_URL;
  });

  beforeEach(async () => {
    await WmsTestDatabase.clearAllTables();
  });

  describe('POST /inventory/reservations - Create Reservation', () => {
    it('should return 201 Created with sufficient stock', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100,
      });

      const reserveDto = {
        targetType: 'FO',
        targetId: 'fo-001',
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 50,
      };

      const response = await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send(reserveDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('status');
      expect(response.body.quantity).toBe(50);
      expect(response.body.skuId).toBe(sku.id);
    });

    it('should return 400 Bad Request with insufficient stock', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 10,
        availableQty: 10,
      });

      const reserveDto = {
        targetType: 'FO',
        targetId: 'fo-002',
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 100,
      };

      await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send(reserveDto)
        .expect(400);
    });

    it('should return 400 Bad Request with zero quantity', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const reserveDto = {
        targetType: 'FO',
        targetId: 'fo-003',
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 0,
      };

      await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send(reserveDto)
        .expect(400);
    });

    it('should create reservation with timeout (timeoutAt)', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100,
      });

      const timeoutAt = new Date(Date.now() + 3600000).toISOString();

      const reserveDto = {
        targetType: 'FO',
        targetId: 'fo-timeout',
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 30,
        timeoutAt,
      };

      const response = await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send(reserveDto)
        .expect(201);

      expect(response.body.timeoutAt).toBeDefined();
    });
  });

  describe('GET /inventory/reservations/:id - Get Reservation', () => {
    it('should return 200 OK with reservation details', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100,
      });

      const reserveDto = {
        targetType: 'FO',
        targetId: 'fo-get-test',
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 25,
      };

      const createResponse = await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send(reserveDto)
        .expect(201);

      const reservationId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .get(`/inventory/reservations/${reservationId}`)
        .expect(200);

      expect(response.body.id).toBe(reservationId);
      expect(response.body.quantity).toBe(25);
    });

    it('should return 404 Not Found for non-existent reservation', async () => {
      const fakeReservationId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/inventory/reservations/${fakeReservationId}`)
        .expect(404);
    });
  });

  describe('PATCH /inventory/reservations/:id/release - Release Reservation', () => {
    it('should return 200 OK and restore available stock', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100,
      });

      const reserveDto = {
        targetType: 'FO',
        targetId: 'fo-release-test',
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 40,
      };

      const createResponse = await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send(reserveDto)
        .expect(201);

      const reservationId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .patch(`/inventory/reservations/${reservationId}/release`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 404 Not Found for non-existent reservation', async () => {
      const fakeReservationId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .patch(`/inventory/reservations/${fakeReservationId}/release`)
        .expect(404);
    });
  });

  describe('POST /inventory/reservations/allocate - Allocate Stock', () => {
    it('should return 201 Created with FIFO strategy', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'ALLOC-LOC',
        locationType: 'zone',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 100,
        stockState: 'ON_HAND',
      });

      const allocateDto = {
        skuId: sku.id,
        requestedQuantity: 50,
        strategy: 'FIFO',
      };

      const response = await request(app.getHttpServer())
        .post('/inventory/reservations/allocate')
        .send(allocateDto)
        .expect(201);

      expect(response.body).toHaveProperty('allocations');
      expect(response.body.allocations).toBeInstanceOf(Array);
      expect(response.body.totalAllocated).toBe(50);
      expect(response.body.isPartial).toBe(false);
    });

    it('should return 201 Created with LOCATION_PRIORITY strategy', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      const [highPriorityLoc] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'HIGH-PRIORITY',
        locationType: 'zone',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: highPriorityLoc.id,
        qty: 75,
        stockState: 'ON_HAND',
      });

      const allocateDto = {
        skuId: sku.id,
        requestedQuantity: 60,
        strategy: 'LOCATION_PRIORITY',
      };

      const response = await request(app.getHttpServer())
        .post('/inventory/reservations/allocate')
        .send(allocateDto)
        .expect(201);

      expect(response.body.totalAllocated).toBe(60);
      expect(response.body.allocations[0].locationId).toBe(highPriorityLoc.id);
    });

    it('should return allocation plan with locations and quantities', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'PLAN-LOC',
        locationType: 'zone',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 200,
        stockState: 'ON_HAND',
      });

      const allocateDto = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'FIFO',
      };

      const response = await request(app.getHttpServer())
        .post('/inventory/reservations/allocate')
        .send(allocateDto)
        .expect(201);

      expect(response.body.allocations).toHaveLength(1);
      expect(response.body.allocations[0]).toHaveProperty('warehouseId');
      expect(response.body.allocations[0]).toHaveProperty('locationId');
      expect(response.body.allocations[0]).toHaveProperty('quantity');
      expect(response.body.allocations[0]).toHaveProperty('locationCode');
      expect(response.body.allocations[0].quantity).toBe(100);
    });

    it('should return 400 Bad Request with insufficient stock', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'INSUFF-LOC',
        locationType: 'zone',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 10,
        stockState: 'ON_HAND',
      });

      const allocateDto = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'FIFO',
        allowPartial: false,
      };

      await request(app.getHttpServer())
        .post('/inventory/reservations/allocate')
        .send(allocateDto)
        .expect(400);
    });

    it('should handle partial allocation when allowPartial is true', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'PARTIAL-LOC',
        locationType: 'zone',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 30,
        stockState: 'ON_HAND',
      });

      const allocateDto = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'FIFO',
        allowPartial: true,
      };

      const response = await request(app.getHttpServer())
        .post('/inventory/reservations/allocate')
        .send(allocateDto)
        .expect(201);

      expect(response.body.totalAllocated).toBe(30);
      expect(response.body.isPartial).toBe(true);
    });
  });

  describe('GET /inventory/reservations - List Reservations', () => {
    it('should return 200 OK with all reservations', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 200,
        availableQty: 200,
      });

      await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          targetType: 'FO',
          targetId: 'fo-list-1',
          skuId: sku.id,
          warehouseId: warehouse.id,
          quantity: 50,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          targetType: 'FO',
          targetId: 'fo-list-2',
          skuId: sku.id,
          warehouseId: warehouse.id,
          quantity: 30,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/inventory/reservations')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by skuId', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku1 = await WmsTestFactory.createSku();
      const sku2 = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku1.id,
        onHandQty: 100,
        availableQty: 100,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku2.id,
        onHandQty: 100,
        availableQty: 100,
      });

      await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          targetType: 'FO',
          targetId: 'fo-filter-1',
          skuId: sku1.id,
          warehouseId: warehouse.id,
          quantity: 20,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          targetType: 'FO',
          targetId: 'fo-filter-2',
          skuId: sku2.id,
          warehouseId: warehouse.id,
          quantity: 30,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/inventory/reservations?skuId=${sku1.id}`)
        .expect(200);

      expect(response.body.every(r => r.skuId === sku1.id)).toBe(true);
    });

    it('should filter by warehouseId', async () => {
      const warehouse1 = await WmsTestFactory.createWarehouse({ name: 'WH1' });
      const warehouse2 = await WmsTestFactory.createWarehouse({ name: 'WH2' });
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse1.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse2.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100,
      });

      await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          targetType: 'FO',
          targetId: 'fo-wh-1',
          skuId: sku.id,
          warehouseId: warehouse1.id,
          quantity: 25,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          targetType: 'FO',
          targetId: 'fo-wh-2',
          skuId: sku.id,
          warehouseId: warehouse2.id,
          quantity: 35,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/inventory/reservations?warehouseId=${warehouse1.id}`)
        .expect(200);

      expect(response.body.every(r => r.warehouseId === warehouse1.id)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle creating multiple concurrent reservations', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 500,
        availableQty: 500,
      });

      const reservations: SupertestTest[] = [];
      for (let i = 0; i < 5; i++) {
        reservations.push(
          request(app.getHttpServer())
            .post('/inventory/reservations')
            .send({
              targetType: 'FO',
              targetId: `fo-concurrent-${i}`,
              skuId: sku.id,
              warehouseId: warehouse.id,
              quantity: 20,
            })
        );
      }

      const responses = await Promise.all(reservations);

      responses.forEach(response => {
        expect(response.status).toBe(201);
      });
    });
  });
});

