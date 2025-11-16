import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PimModule } from '../../src/pim.module';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import type { CreateMasterDto } from '../../src/types';

describe('ProductMastersController - E2E Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await PimTestDatabase.setup();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PimModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Enable validation pipes (same as production)
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
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  describe('POST /masters - 상품 생성', () => {
    it('✅ 201 Created + 생성된 master 반환', async () => {
      const createDto: CreateMasterDto = {
        name: 'Test Product',
        description: 'Test Description',
        brand: 'Test Brand',
        basePrice: 10000,
        pricingStrategy: 'option_based',
      };

      const response = await request(app.getHttpServer())
        .post('/masters')
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Test Product');
      expect(response.body.basePrice).toBe(10000);
    });

    it('✅ 옵션 포함 생성 (백그라운드 처리)', async () => {
      const createDto: CreateMasterDto = {
        name: 'Product with Options',
        basePrice: 15000,
        pricingStrategy: 'option_based',
        optionGroups: [
          {
            name: 'size',
            displayName: '사이즈',
            values: [
              { value: 'S', displayName: 'Small' },
              { value: 'M', displayName: 'Medium' },
            ]
          }
        ],
        // 가격 데이터는 옵션 생성 후 별도로 설정 가능
        // optionValuePrices: { 'option-value-id': 1000 }
      };

      const response = await request(app.getHttpServer())
        .post('/masters')
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Product with Options');
    });

    it('❌ 400 Bad Request (필수 필드 누락)', async () => {
      const invalidDto = {
        description: 'Missing required fields',
      };

      await request(app.getHttpServer())
        .post('/masters')
        .send(invalidDto)
        .expect(400);
    });
  });

  describe('GET /masters - 목록 조회', () => {
    it('✅ 200 OK + 페이징된 목록 반환', async () => {
      await PimTestFactory.createMaster({ name: 'Product 1', basePrice: 1000 });
      await PimTestFactory.createMaster({ name: 'Product 2', basePrice: 2000 });
      await PimTestFactory.createMaster({ name: 'Product 3', basePrice: 3000 });

      const response = await request(app.getHttpServer())
        .get('/masters?page=1&limit=2')
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.total).toBe(3);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(2);
    });

    it('✅ Query params 처리 (status, brand, search)', async () => {
      await PimTestFactory.createMaster({
        name: 'Apple iPhone',
        brand: 'Apple',
        basePrice: 1000000,
      });

      await PimTestFactory.createMaster({
        name: 'Samsung Galaxy',
        brand: 'Samsung',
        basePrice: 900000,
      });

      // Brand 필터
      const brandResponse = await request(app.getHttpServer())
        .get('/masters?brand=Apple')
        .expect(200);

      expect(brandResponse.body.data).toHaveLength(1);
      expect(brandResponse.body.data[0].brand).toBe('Apple');

      // Search 필터
      const searchResponse = await request(app.getHttpServer())
        .get('/masters?search=Galaxy')
        .expect(200);

      expect(searchResponse.body.data).toHaveLength(1);
      expect(searchResponse.body.data[0].name).toContain('Galaxy');
    });

    it('✅ 빈 결과 처리', async () => {
      const response = await request(app.getHttpServer())
        .get('/masters?page=1&limit=10')
        .expect(200);

      expect(response.body.data).toHaveLength(0);
      expect(response.body.total).toBe(0);
    });
  });

  describe('GET /masters/:id - 상세 조회', () => {
    it('✅ 200 OK + 상세 정보 반환', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Detail Test Product',
        description: 'Detail Description',
        basePrice: 20000,
      });

      const response = await request(app.getHttpServer())
        .get(`/masters/${master.id}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', master.id);
      expect(response.body).toHaveProperty('name', 'Detail Test Product');
      expect(response.body).toHaveProperty('optionGroups');
      expect(response.body).toHaveProperty('variants');
      expect(response.body).toHaveProperty('channelProducts');
    });

    it('❌ 404 Not Found (존재하지 않는 ID)', async () => {
      await request(app.getHttpServer())
        .get('/masters/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PUT /masters/:id - 수정', () => {
    it('✅ 200 OK + 수정된 master 반환', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Original Name',
        basePrice: 10000,
      });

      const updateDto = {
        name: 'Updated Name',
        basePrice: 15000,
      };

      const response = await request(app.getHttpServer())
        .put(`/masters/${master.id}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Updated Name');
      expect(response.body.data.basePrice).toBe(15000);
    });

    it('✅ 부분 수정 (일부 필드만)', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Original Name',
        description: 'Original Description',
        basePrice: 10000,
      });

      const updateDto = {
        description: 'Updated Description',
      };

      const response = await request(app.getHttpServer())
        .put(`/masters/${master.id}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.data.name).toBe('Original Name');
      expect(response.body.data.description).toBe('Updated Description');
    });

    it('❌ 404 Not Found (존재하지 않는 ID)', async () => {
      await request(app.getHttpServer())
        .put('/masters/00000000-0000-0000-0000-000000000000')
        .send({ name: 'Update Attempt' })
        .expect(404);
    });
  });

  describe('DELETE /masters/:id - Soft Delete', () => {
    it('✅ 200 OK + 삭제된 master 반환 (deletedAt 포함)', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'To Be Deleted',
      });

      const response = await request(app.getHttpServer())
        .delete(`/masters/${master.id}`)
        .send({ userId: '00000000-0000-0000-0000-000000000001' })
        .expect(200);

      expect(response.body).toHaveProperty('deletedAt');
      expect(response.body.deletedAt).not.toBeNull();
    });

    it('✅ 삭제 후 기본 조회에서 제외 확인', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Deleted Product',
      });

      // Delete
      await request(app.getHttpServer())
        .delete(`/masters/${master.id}`)
        .send({ userId: '00000000-0000-0000-0000-000000000001' })
        .expect(200);

      // Try to get (should return 404)
      await request(app.getHttpServer())
        .get(`/masters/${master.id}`)
        .expect(404);
    });

    it('❌ 404 Not Found', async () => {
      await request(app.getHttpServer())
        .delete('/masters/00000000-0000-0000-0000-000000000000')
        .send({ userId: '00000000-0000-0000-0000-000000000001' })
        .expect(404);
    });
  });

  describe('POST /masters/:id/restore - 복원', () => {
    it('✅ 200 OK + 복원된 master 반환', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'To Be Restored',
      });

      // Delete first
      await request(app.getHttpServer())
        .delete(`/masters/${master.id}`)
        .send({ userId: '00000000-0000-0000-0000-000000000001' })
        .expect(200);

      // Restore
      const response = await request(app.getHttpServer())
        .post(`/masters/${master.id}/restore`)
        .send({ userId: '00000000-0000-0000-0000-000000000002' })
        .expect(200);

      expect(response.body.deletedAt).toBeNull();
    });

    it('✅ deletedAt null로 복원 확인', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Restoration Test',
      });

      // Delete
      await request(app.getHttpServer())
        .delete(`/masters/${master.id}`)
        .send({ userId: '00000000-0000-0000-0000-000000000001' });

      // Restore
      await request(app.getHttpServer())
        .post(`/masters/${master.id}/restore`)
        .send({ userId: '00000000-0000-0000-0000-000000000002' })
        .expect(200);

      // Should be accessible again
      await request(app.getHttpServer())
        .get(`/masters/${master.id}`)
        .expect(200);
    });

    it('❌ 404 Not Found', async () => {
      await request(app.getHttpServer())
        .post('/masters/00000000-0000-0000-0000-000000000000/restore')
        .send({ userId: '00000000-0000-0000-0000-000000000001' })
        .expect(404);
    });

    it('❌ 400 Bad Request (삭제되지 않음)', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Not Deleted',
      });

      await request(app.getHttpServer())
        .post(`/masters/${master.id}/restore`)
        .send({ userId: '00000000-0000-0000-0000-000000000001' })
        .expect(400);
    });
  });

  describe('DELETE /masters/:id/permanent - Hard Delete', () => {
    it('✅ 200 OK + { deleted: true }', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Permanent Delete Test',
      });

      const response = await request(app.getHttpServer())
        .delete(`/masters/${master.id}/permanent`)
        .send({ userId: '00000000-0000-0000-0000-000000000001' })
        .expect(200);

      expect(response.body.deleted).toBe(true);
    });

    it('✅ 데이터 완전 삭제 확인', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Hard Delete Check',
      });

      // Hard delete
      await request(app.getHttpServer())
        .delete(`/masters/${master.id}/permanent`)
        .send({ userId: '00000000-0000-0000-0000-000000000001' })
        .expect(200);

      // Should not be found
      await request(app.getHttpServer())
        .get(`/masters/${master.id}`)
        .expect(404);
    });

    it('❌ 404 Not Found', async () => {
      await request(app.getHttpServer())
        .delete('/masters/00000000-0000-0000-0000-000000000000/permanent')
        .send({ userId: '00000000-0000-0000-0000-000000000001' })
        .expect(404);
    });
  });

  describe('GET /masters/deleted - 삭제된 항목 목록', () => {
    it('✅ 200 OK + soft deleted 항목 배열', async () => {
      const master1 = await PimTestFactory.createMaster({ name: 'Product 1' });
      const master2 = await PimTestFactory.createMaster({ name: 'Product 2' });

      // Delete master1
      await request(app.getHttpServer())
        .delete(`/masters/${master1.id}`)
        .send({ userId: '00000000-0000-0000-0000-000000000001' });

      const response = await request(app.getHttpServer())
        .get('/masters/deleted')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].id).toBe(master1.id);
    });

    it('✅ 빈 배열 처리', async () => {
      const response = await request(app.getHttpServer())
        .get('/masters/deleted')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /masters/:id/price-preview - 가격 미리보기', () => {
    it('✅ 200 OK + variants별 가격 배열', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Price Preview Test',
        basePrice: 10000,
        pricingStrategy: 'option_based',
      });

      const sizeGroup = await PimTestFactory.createOptionGroup(master.id, {
        name: 'size',
        displayName: '사이즈',
      });

      const sizeS = await PimTestFactory.createOptionValue(sizeGroup.id, {
        value: 'S',
        displayName: 'Small',
      });

      await PimTestFactory.setOptionValuePrice(master.id, sizeS.id, 0);

      const variantS = await PimTestFactory.createVariant(master.id, {
        variantName: 'Small',
      });

      await PimTestFactory.linkVariantToOptionValue(variantS.id, sizeS.id);

      const response = await request(app.getHttpServer())
        .get(`/masters/${master.id}/price-preview`)
        .expect(200);

      expect(response.body).toHaveProperty('masterId', master.id);
      expect(response.body).toHaveProperty('variants');
      expect(Array.isArray(response.body.variants)).toBe(true);
    });

    it('❌ 404 Not Found', async () => {
      await request(app.getHttpServer())
        .get('/masters/00000000-0000-0000-0000-000000000000/price-preview')
        .expect(404);
    });
  });

  describe('PUT /masters/:id/pricing - 가격 전략 변경', () => {
    it('✅ 200 OK', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Pricing Strategy Test',
        pricingStrategy: 'option_based',
      });

      await request(app.getHttpServer())
        .put(`/masters/${master.id}/pricing`)
        .send({
          pricingStrategy: 'variant_based',
          migrationData: {}
        })
        .expect(200);
    });

    it('✅ 전략 변경 후 pricingStrategy 필드 확인', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Strategy Change Check',
        pricingStrategy: 'option_based',
      });

      await request(app.getHttpServer())
        .put(`/masters/${master.id}/pricing`)
        .send({
          pricingStrategy: 'variant_based',
        });

      const response = await request(app.getHttpServer())
        .get(`/masters/${master.id}`)
        .expect(200);

      expect(response.body.pricingStrategy).toBe('variant_based');
    });

    it('❌ 404 Not Found', async () => {
      await request(app.getHttpServer())
        .put('/masters/00000000-0000-0000-0000-000000000000/pricing')
        .send({
          pricingStrategy: 'variant_based',
        })
        .expect(404);
    });

    it('❌ 400 Bad Request (pricingStrategy 누락)', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Missing Strategy Test',
      });

      await request(app.getHttpServer())
        .put(`/masters/${master.id}/pricing`)
        .send({})
        .expect(400);
    });
  });

  describe('Error Handling', () => {
    it('✅ Controller에서 Service 에러를 적절한 HTTP 상태로 변환', async () => {
      // Not found error → 404
      await request(app.getHttpServer())
        .get('/masters/00000000-0000-0000-0000-000000000000')
        .expect(404);

      // Invalid data → 400
      await request(app.getHttpServer())
        .post('/masters')
        .send({})
        .expect(400);
    });
  });
});

