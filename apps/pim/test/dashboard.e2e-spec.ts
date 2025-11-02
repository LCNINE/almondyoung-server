import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PimModule } from '../src/pim.module';

describe('Dashboard API (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
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

  describe('GET /dashboard/metrics', () => {
    it('should return 200 and dashboard metrics', () => {
      return request(app.getHttpServer())
        .get('/dashboard/metrics')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('totalProducts');
          expect(res.body).toHaveProperty('createdToday');
          expect(res.body).toHaveProperty('outOfStock');
          expect(res.body).toHaveProperty('byStatus');
          expect(res.body).toHaveProperty('byApproval');
          
          expect(typeof res.body.totalProducts).toBe('number');
          expect(typeof res.body.createdToday).toBe('number');
          expect(typeof res.body.outOfStock).toBe('number');
          expect(Array.isArray(res.body.byStatus)).toBe(true);
          expect(Array.isArray(res.body.byApproval)).toBe(true);
        });
    });

    it('should return non-negative counts', () => {
      return request(app.getHttpServer())
        .get('/dashboard/metrics')
        .expect(200)
        .expect((res) => {
          expect(res.body.totalProducts).toBeGreaterThanOrEqual(0);
          expect(res.body.createdToday).toBeGreaterThanOrEqual(0);
          expect(res.body.outOfStock).toBeGreaterThanOrEqual(0);
        });
    });

    it('should return status breakdown with correct structure', () => {
      return request(app.getHttpServer())
        .get('/dashboard/metrics')
        .expect(200)
        .expect((res) => {
          if (res.body.byStatus.length > 0) {
            const statusItem = res.body.byStatus[0];
            expect(statusItem).toHaveProperty('status');
            expect(statusItem).toHaveProperty('count');
            expect(typeof statusItem.status).toBe('string');
            expect(typeof statusItem.count).toBe('number');
          }
        });
    });

    it('should return approval breakdown with correct structure', () => {
      return request(app.getHttpServer())
        .get('/dashboard/metrics')
        .expect(200)
        .expect((res) => {
          if (res.body.byApproval.length > 0) {
            const approvalItem = res.body.byApproval[0];
            expect(approvalItem).toHaveProperty('approvalStatus');
            expect(approvalItem).toHaveProperty('count');
            expect(typeof approvalItem.approvalStatus).toBe('string');
            expect(typeof approvalItem.count).toBe('number');
          }
        });
    });
  });

  describe('GET /dashboard/top-products', () => {
    it('should return 200 and array of products', () => {
      return request(app.getHttpServer())
        .get('/dashboard/top-products')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('should return at most 5 products by default', () => {
      return request(app.getHttpServer())
        .get('/dashboard/top-products')
        .expect(200)
        .expect((res) => {
          expect(res.body.length).toBeLessThanOrEqual(5);
        });
    });

    it('should respect custom limit parameter', () => {
      return request(app.getHttpServer())
        .get('/dashboard/top-products?limit=3')
        .expect(200)
        .expect((res) => {
          expect(res.body.length).toBeLessThanOrEqual(3);
        });
    });

    it('should return products with correct structure', () => {
      return request(app.getHttpServer())
        .get('/dashboard/top-products')
        .expect(200)
        .expect((res) => {
          if (res.body.length > 0) {
            const product = res.body[0];
            expect(product).toHaveProperty('id');
            expect(product).toHaveProperty('name');
            expect(product).toHaveProperty('basePrice');
            expect(product).toHaveProperty('status');
            expect(product).toHaveProperty('approvalStatus');
            expect(product).toHaveProperty('createdAt');
            
            expect(typeof product.id).toBe('string');
            expect(typeof product.name).toBe('string');
            expect(typeof product.basePrice).toBe('number');
            expect(typeof product.status).toBe('string');
            expect(typeof product.approvalStatus).toBe('string');
          }
        });
    });

    it('should return 400 for invalid limit (too small)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/top-products?limit=0')
        .expect(400);
    });

    it('should return 400 for invalid limit (too large)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/top-products?limit=101')
        .expect(400);
    });

    it('should return 400 for invalid limit (negative)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/top-products?limit=-1')
        .expect(400);
    });

    it('should handle limit=1', () => {
      return request(app.getHttpServer())
        .get('/dashboard/top-products?limit=1')
        .expect(200)
        .expect((res) => {
          expect(res.body.length).toBeLessThanOrEqual(1);
        });
    });

    it('should handle limit=100 (max)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/top-products?limit=100')
        .expect(200)
        .expect((res) => {
          expect(res.body.length).toBeLessThanOrEqual(100);
        });
    });
  });

  describe('GET /dashboard/sales-trends', () => {
    it('should return 200 and sales trend structure', () => {
      return request(app.getHttpServer())
        .get('/dashboard/sales-trends')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('labels');
          expect(res.body).toHaveProperty('data');
          expect(Array.isArray(res.body.labels)).toBe(true);
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('should return empty arrays (placeholder for Order service)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/sales-trends')
        .expect(200)
        .expect((res) => {
          expect(res.body.labels).toEqual([]);
          expect(res.body.data).toEqual([]);
        });
    });

    it('should respect custom days parameter', () => {
      return request(app.getHttpServer())
        .get('/dashboard/sales-trends?days=7')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('labels');
          expect(res.body).toHaveProperty('data');
        });
    });

    it('should accept days=30 (default)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/sales-trends?days=30')
        .expect(200);
    });

    it('should accept days=365 (max)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/sales-trends?days=365')
        .expect(200);
    });

    it('should return 400 for invalid days (too small)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/sales-trends?days=0')
        .expect(400);
    });

    it('should return 400 for invalid days (too large)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/sales-trends?days=366')
        .expect(400);
    });

    it('should return 400 for invalid days (negative)', () => {
      return request(app.getHttpServer())
        .get('/dashboard/sales-trends?days=-1')
        .expect(400);
    });

    it('should handle days=1', () => {
      return request(app.getHttpServer())
        .get('/dashboard/sales-trends?days=1')
        .expect(200);
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent requests to metrics', async () => {
      const requests = Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).get('/dashboard/metrics'),
      );

      const responses = await Promise.all(requests);

      responses.forEach((res) => {
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('totalProducts');
      });
    });

    it('should handle concurrent requests to top-products', async () => {
      const requests = Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).get('/dashboard/top-products?limit=3'),
      );

      const responses = await Promise.all(requests);

      responses.forEach((res) => {
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      });
    });

    it('should return consistent metrics across multiple calls', async () => {
      const response1 = await request(app.getHttpServer()).get('/dashboard/metrics');
      const response2 = await request(app.getHttpServer()).get('/dashboard/metrics');

      expect(response1.body.totalProducts).toBe(response2.body.totalProducts);
      expect(response1.body.createdToday).toBe(response2.body.createdToday);
    });
  });

  describe('Performance', () => {
    it('should respond to metrics endpoint within reasonable time', async () => {
      const startTime = Date.now();
      
      await request(app.getHttpServer())
        .get('/dashboard/metrics')
        .expect(200);
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      // Should respond within 1 second
      expect(responseTime).toBeLessThan(1000);
    });

    it('should respond to top-products endpoint within reasonable time', async () => {
      const startTime = Date.now();
      
      await request(app.getHttpServer())
        .get('/dashboard/top-products?limit=10')
        .expect(200);
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      // Should respond within 1 second
      expect(responseTime).toBeLessThan(1000);
    });
  });
});

