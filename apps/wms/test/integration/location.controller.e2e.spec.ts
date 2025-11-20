import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { InventoryModule } from '../../src/inventory/inventory.module';
import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { eq, and } from 'drizzle-orm';

describe('LocationController - E2E Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await WmsTestDatabase.setup();

    process.env.DATABASE_URL = WmsTestDatabase.getConnectionString();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [InventoryModule],
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

  describe('POST /locations/warehouses/:warehouseId/columns - Create Column', () => {
    it('should return 201 Created with valid data', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createDto = {
        code: 'COL-A',
        name: 'Column A',
      };

      const response = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/columns`)
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.code).toBe('COL-A');
      expect(response.body.name).toBe('Column A');
      expect(response.body.type).toBe('column');
      expect(response.body.warehouseId).toBe(warehouse.id);
    });

    it('should return 400 Bad Request with invalid warehouseId', async () => {
      const invalidWarehouseId = 'invalid-uuid';

      const createDto = {
        code: 'COL-B',
        name: 'Column B',
      };

      await request(app.getHttpServer())
        .post(`/locations/warehouses/${invalidWarehouseId}/columns`)
        .send(createDto)
        .expect(400);
    });

    it('should return 400 Bad Request with duplicate code', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createDto = {
        code: 'COL-DUP',
        name: 'Column Duplicate',
      };

      await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/columns`)
        .send(createDto)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/columns`)
        .send(createDto)
        .expect(400);
    });
  });

  describe('POST /locations/warehouses/:warehouseId/racks - Create Rack', () => {
    it('should return 201 Created with bin structure', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createDto = {
        code: 'RACK-001',
        rows: 4,
        levels: 3,
        depth: 2,
      };

      const response = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/racks`)
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('bins');
      expect(response.body.bins).toBeInstanceOf(Array);
      expect(response.body.bins.length).toBe(24); // 4 * 3 * 2
    });

    it('should create bins with proper naming (A1-L1, A1-L2, etc.)', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createDto = {
        code: 'RACK-NAME',
        rows: 2,
        levels: 3,
        depth: 1,
      };

      const response = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/racks`)
        .send(createDto)
        .expect(201);

      const binCodes = response.body.bins.map(b => b.code);

      expect(binCodes).toContain('RACK-NAME-A1-L1');
      expect(binCodes).toContain('RACK-NAME-A1-L2');
      expect(binCodes).toContain('RACK-NAME-A1-L3');
      expect(binCodes).toContain('RACK-NAME-A2-L1');
      expect(binCodes).toContain('RACK-NAME-A2-L2');
      expect(binCodes).toContain('RACK-NAME-A2-L3');
    });

    it('should return 400 Bad Request with zero dimensions', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createDto = {
        code: 'RACK-ZERO',
        rows: 0,
        levels: 3,
        depth: 2,
      };

      await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/racks`)
        .send(createDto)
        .expect(400);
    });
  });

  describe('GET /locations/warehouses/:warehouseId - List Locations', () => {
    it('should return 200 OK with all locations in warehouse', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/columns`)
        .send({ code: 'COL-1', name: 'Column 1' });

      await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/columns`)
        .send({ code: 'COL-2', name: 'Column 2' });

      const response = await request(app.getHttpServer())
        .get(`/locations/warehouses/${warehouse.id}`)
        .expect(200);

      expect(response.body).toHaveProperty('locations');
      expect(response.body.locations).toBeInstanceOf(Array);
      expect(response.body.locations.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by type', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/columns`)
        .send({ code: 'COL-FILTER', name: 'Column Filter' });

      const response = await request(app.getHttpServer())
        .get(`/locations/warehouses/${warehouse.id}?type=column`)
        .expect(200);

      const columnLocations = response.body.locations.filter(l => l.type === 'column');
      expect(columnLocations.length).toBeGreaterThan(0);
    });

    it('should include system locations', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const response = await request(app.getHttpServer())
        .get(`/locations/warehouses/${warehouse.id}`)
        .expect(200);

      const systemLocations = response.body.locations.filter(l => l.isSystemLocation);
      expect(systemLocations.length).toBeGreaterThan(0);
    });
  });

  describe('PUT /locations/:id - Update Location', () => {
    it('should return 200 OK and update location name', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createResponse = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/columns`)
        .send({ code: 'COL-UPDATE', name: 'Original Name' })
        .expect(201);

      const locationId = createResponse.body.id;

      const updateDto = {
        name: 'Updated Name',
      };

      const response = await request(app.getHttpServer())
        .put(`/locations/${locationId}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
      expect(response.body.code).toBe('COL-UPDATE');
    });

    it('should return 200 OK and update capacity', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createResponse = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/zones`)
        .send({
          code: 'ZONE-CAP',
          name: 'Zone Capacity Test',
          zone: 'Z',
          capacity: 100,
        })
        .expect(201);

      const locationId = createResponse.body.id;

      const updateDto = {
        capacity: 500,
      };

      const response = await request(app.getHttpServer())
        .put(`/locations/${locationId}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.capacity).toBe(500);
    });

    it('should return 404 Not Found for non-existent location', async () => {
      const fakeLocationId = '00000000-0000-0000-0000-000000000000';

      const updateDto = {
        name: 'New Name',
      };

      await request(app.getHttpServer())
        .put(`/locations/${fakeLocationId}`)
        .send(updateDto)
        .expect(404);
    });
  });

  describe('DELETE /locations/:id - Delete Location', () => {
    it('should return 204 No Content on success', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createResponse = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/zones`)
        .send({
          code: 'DELETE-ME',
          name: 'Delete Me Location',
          zone: 'D',
        })
        .expect(201);

      const locationId = createResponse.body.id;

      await request(app.getHttpServer())
        .delete(`/locations/${locationId}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/locations/${locationId}`)
        .expect(404);
    });

    it('should return 404 Not Found for non-existent location', async () => {
      const fakeLocationId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .delete(`/locations/${fakeLocationId}`)
        .expect(404);
    });

    it('should return 409 Conflict if system location', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const db = WmsTestDatabase.getDb();
      const systemLocation = await db.query.locations.findFirst({
        where: and(
          eq(wmsTables.locations.warehouseId, warehouse.id),
          eq(wmsTables.locations.systemRole, 'INBOUND_STAGING' as any)
        ),
      });

      if (systemLocation) {
        await request(app.getHttpServer())
          .delete(`/locations/${systemLocation.id}`)
          .expect(409);
      }
    });

    it('should return 409 Conflict if location has stock', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const createResponse = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/zones`)
        .send({
          code: 'LOC-WITH-STOCK',
          name: 'Location With Stock',
          zone: 'S',
        })
        .expect(201);

      const locationId = createResponse.body.id;

      const db = WmsTestDatabase.getDb();
      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: locationId,
        qty: 100,
        stockState: 'ON_HAND',
      });

      await request(app.getHttpServer())
        .delete(`/locations/${locationId}`)
        .expect(409);
    });
  });

  describe('GET /locations/:id - Get Location Details', () => {
    it('should return 200 OK with location details', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createResponse = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/columns`)
        .send({ code: 'COL-DETAIL', name: 'Column Detail Test' })
        .expect(201);

      const locationId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .get(`/locations/${locationId}`)
        .expect(200);

      expect(response.body.id).toBe(locationId);
      expect(response.body.code).toBe('COL-DETAIL');
      expect(response.body.type).toBe('column');
    });

    it('should return 404 Not Found for non-existent location', async () => {
      const fakeLocationId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/locations/${fakeLocationId}`)
        .expect(404);
    });
  });

  describe('Edge Cases', () => {
    it('should handle creating very large rack', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const createDto = {
        code: 'LARGE-RACK',
        rows: 10,
        levels: 5,
        depth: 3,
      };

      const response = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse.id}/racks`)
        .send(createDto)
        .expect(201);

      expect(response.body.bins.length).toBe(150);
    });

    it('should allow duplicate codes in different warehouses', async () => {
      const warehouse1 = await WmsTestFactory.createWarehouse({ name: 'WH1' });
      const warehouse2 = await WmsTestFactory.createWarehouse({ name: 'WH2' });

      const createDto = {
        code: 'COL-DUPLICATE',
        name: 'Column Duplicate',
      };

      const response1 = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse1.id}/columns`)
        .send(createDto)
        .expect(201);

      const response2 = await request(app.getHttpServer())
        .post(`/locations/warehouses/${warehouse2.id}/columns`)
        .send(createDto)
        .expect(201);

      expect(response1.body.code).toBe('COL-DUPLICATE');
      expect(response2.body.code).toBe('COL-DUPLICATE');
      expect(response1.body.warehouseId).not.toBe(response2.body.warehouseId);
    });
  });
});

