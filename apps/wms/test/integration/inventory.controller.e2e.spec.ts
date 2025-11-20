import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { InventoryModule } from '../../src/inventory/inventory.module';
import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { DbService } from '@app/db';

describe('InventoryController - E2E Tests', () => {
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

  describe('GET /inventory/stocks - Stock Query', () => {
    it('should return 200 OK with skuId filter', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100,
      });

      const response = await request(app.getHttpServer())
        .get(`/inventory/stocks?skuId=${sku.id}`)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].skuId).toBe(sku.id);
    });

    it('should return 200 OK with warehouseId filter', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 50,
        availableQty: 50,
      });

      const response = await request(app.getHttpServer())
        .get(`/inventory/stocks?warehouseId=${warehouse.id}`)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].warehouseId).toBe(warehouse.id);
    });

    it('should return empty array when no matches', async () => {
      const fakeSkuId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app.getHttpServer())
        .get(`/inventory/stocks?skuId=${fakeSkuId}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /inventory/stocks/summary - Summary Query', () => {
    it('should return 200 OK with aggregated data', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 80,
        reservedQty: 20,
      });

      const response = await request(app.getHttpServer())
        .get(`/inventory/stocks/summary?skuId=${sku.id}`)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('currentQuantity');
      expect(response.body[0]).toHaveProperty('availableQuantity');
      expect(response.body[0]).toHaveProperty('reservedQuantity');
      expect(response.body[0].currentQuantity).toBe(100);
      expect(response.body[0].availableQuantity).toBe(80);
      expect(response.body[0].reservedQuantity).toBe(20);
    });

    it('should filter by warehouseId', async () => {
      const warehouse1 = await WmsTestFactory.createWarehouse({ name: 'WH1' });
      const warehouse2 = await WmsTestFactory.createWarehouse({ name: 'WH2' });
      const sku = await WmsTestFactory.createSku();

      await WmsTestFactory.createStock({
        warehouseId: warehouse1.id,
        skuId: sku.id,
        onHandQty: 100,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse2.id,
        skuId: sku.id,
        onHandQty: 200,
      });

      const response = await request(app.getHttpServer())
        .get(`/inventory/stocks/summary?warehouseId=${warehouse1.id}`)
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body.every(item => item.warehouseId === warehouse1.id)).toBe(true);
    });

    it('should return empty array when no stock', async () => {
      const response = await request(app.getHttpServer())
        .get('/inventory/stocks/summary')
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /inventory/stocks/sku/:skuId/total - Total Stock', () => {
    it('should return 200 OK with sum across all warehouses', async () => {
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
        onHandQty: 150,
        availableQty: 150,
      });

      const response = await request(app.getHttpServer())
        .get(`/inventory/stocks/sku/${sku.id}/total`)
        .expect(200);

      expect(response.body).toHaveProperty('totalQuantity');
      expect(response.body.totalQuantity).toBe(250);
      expect(response.body.totalAvailable).toBe(250);
    });

    it('should return 404 Not Found for non-existent SKU', async () => {
      const fakeSkuId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/inventory/stocks/sku/${fakeSkuId}/total`)
        .expect(404);
    });
  });

  describe('POST /inventory/skus - Create SKU', () => {
    it('should return 201 Created with valid data', async () => {
      const holder = await WmsTestFactory.createHolder();

      const createDto = {
        name: 'Test Product',
        code: 'TEST-PROD-001',
        defaultBarcode: '1234567890123',
        holderId: holder.id,
        stockType: 'physical',
        safetyStock: 50,
      };

      const response = await request(app.getHttpServer())
        .post('/inventory/skus')
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Test Product');
      expect(response.body.code).toBe('TEST-PROD-001');
      expect(response.body.defaultBarcode).toBe('1234567890123');
    });

    it('should return 400 Bad Request with invalid stockType enum', async () => {
      const holder = await WmsTestFactory.createHolder();

      const invalidDto = {
        name: 'Invalid Product',
        code: 'INVALID-001',
        holderId: holder.id,
        stockType: 'invalid_type',
      };

      await request(app.getHttpServer())
        .post('/inventory/skus')
        .send(invalidDto)
        .expect(400);
    });
  });

  describe('PUT /inventory/skus/:id - Update SKU', () => {
    it('should return 200 OK and update name', async () => {
      const sku = await WmsTestFactory.createSku({
        name: 'Original Name',
        code: 'UPDATE-TEST-001',
      });

      const updateDto = {
        name: 'Updated Name',
      };

      const response = await request(app.getHttpServer())
        .put(`/inventory/skus/${sku.id}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
      expect(response.body.code).toBe('UPDATE-TEST-001');
    });

    it('should return 200 OK and update safetyStock', async () => {
      const sku = await WmsTestFactory.createSku({
        name: 'Safety Stock Test',
        code: 'SAFETY-001',
        safetyStock: 10,
      });

      const updateDto = {
        safetyStock: 100,
      };

      const response = await request(app.getHttpServer())
        .put(`/inventory/skus/${sku.id}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.safetyStock).toBe(100);
    });

    it('should return 404 Not Found for non-existent SKU', async () => {
      const fakeSkuId = '00000000-0000-0000-0000-000000000000';

      const updateDto = {
        name: 'New Name',
      };

      await request(app.getHttpServer())
        .put(`/inventory/skus/${fakeSkuId}`)
        .send(updateDto)
        .expect(404);
    });
  });

  describe('GET /inventory/skus - Search SKUs', () => {
    beforeEach(async () => {
      await WmsTestFactory.createSku({
        name: 'iPhone 15 Pro',
        code: 'IPHONE-15-PRO',
        defaultBarcode: '1111111111111',
      });

      await WmsTestFactory.createSku({
        name: 'Samsung Galaxy S24',
        code: 'SAMSUNG-S24',
        defaultBarcode: '2222222222222',
      });
    });

    it('should return 200 OK and search by name', async () => {
      const response = await request(app.getHttpServer())
        .get('/inventory/skus?name=iPhone')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body.some(sku => sku.name.includes('iPhone'))).toBe(true);
    });

    it('should return 200 OK and search by code', async () => {
      const response = await request(app.getHttpServer())
        .get('/inventory/skus?code=IPHONE-15-PRO')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].code).toBe('IPHONE-15-PRO');
    });

    it('should return 200 OK and search by barcode', async () => {
      const response = await request(app.getHttpServer())
        .get('/inventory/skus?barcode=1111111111111')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].defaultBarcode).toBe('1111111111111');
    });

    it('should return empty array when no matches', async () => {
      const response = await request(app.getHttpServer())
        .get('/inventory/skus?code=NON-EXISTENT-CODE')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should perform case-insensitive search', async () => {
      const response = await request(app.getHttpServer())
        .get('/inventory/skus?name=iphone')
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /inventory/skus/:id - Get SKU Details', () => {
    it('should return 200 OK with full SKU data', async () => {
      const sku = await WmsTestFactory.createSku({
        name: 'Detailed Product',
        code: 'DETAIL-001',
      });

      const response = await request(app.getHttpServer())
        .get(`/inventory/skus/${sku.id}`)
        .expect(200);

      expect(response.body.id).toBe(sku.id);
      expect(response.body.name).toBe('Detailed Product');
      expect(response.body.code).toBe('DETAIL-001');
    });

    it('should return 404 Not Found for non-existent SKU', async () => {
      const fakeSkuId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/inventory/skus/${fakeSkuId}`)
        .expect(404);
    });
  });

  describe('POST /inventory/warehouses - Create Warehouse', () => {
    it('should return 201 Created with valid data', async () => {
      const createDto = {
        name: 'Test Warehouse',
        location: 'Seoul, South Korea',
        type: 'domestic',
      };

      const response = await request(app.getHttpServer())
        .post('/inventory/warehouses')
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Test Warehouse');
      expect(response.body.type).toBe('domestic');
    });

    it('should return 400 Bad Request with invalid type', async () => {
      const invalidDto = {
        name: 'Invalid Warehouse',
        type: 'invalid_type',
      };

      await request(app.getHttpServer())
        .post('/inventory/warehouses')
        .send(invalidDto)
        .expect(400);
    });
  });

  describe('GET /inventory/stocks/safety-stock/warnings - Safety Stock Warnings', () => {
    it('should return 200 OK with SKUs below threshold', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      
      const sku = await WmsTestFactory.createSku({
        name: 'Low Stock Item',
        code: 'LOW-STOCK-001',
        safetyStock: 100,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 30,
        availableQty: 30,
      });

      const response = await request(app.getHttpServer())
        .get('/inventory/stocks/safety-stock/warnings')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('skuId');
      expect(response.body[0]).toHaveProperty('currentStock');
      expect(response.body[0]).toHaveProperty('safetyStock');
      expect(response.body[0]).toHaveProperty('shortfall');
    });

    it('should filter by warehouseId', async () => {
      const warehouse1 = await WmsTestFactory.createWarehouse({ name: 'WH1' });
      const warehouse2 = await WmsTestFactory.createWarehouse({ name: 'WH2' });
      
      const sku = await WmsTestFactory.createSku({
        name: 'Multi-WH Low Stock',
        code: 'MULTI-LOW-001',
        safetyStock: 100,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse1.id,
        skuId: sku.id,
        onHandQty: 20,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse2.id,
        skuId: sku.id,
        onHandQty: 15,
      });

      const response = await request(app.getHttpServer())
        .get(`/inventory/stocks/safety-stock/warnings?warehouseId=${warehouse1.id}`)
        .expect(200);

      expect(response.body.every(item => item.warehouseId === warehouse1.id)).toBe(true);
    });

    it('should return empty array when all stock sufficient', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      
      const sku = await WmsTestFactory.createSku({
        name: 'Well Stocked',
        code: 'WELL-STOCKED-001',
        safetyStock: 50,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 200,
      });

      const response = await request(app.getHttpServer())
        .get('/inventory/stocks/safety-stock/warnings')
        .expect(200);

      const warnings = response.body.filter(w => w.skuCode === 'WELL-STOCKED-001');
      expect(warnings).toHaveLength(0);
    });
  });
});

