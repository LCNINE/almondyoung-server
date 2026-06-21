import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { register } from 'prom-client';
import { MetricsController } from './metrics.controller';
import { MetricsService } from '../services/metrics.service';

describe('MetricsController (Fastify)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // MetricsService registers its metrics on prom-client's global registry in
    // field initializers, so clear it first to avoid duplicate-registration
    // throws if anything else in this process touched the registry.
    register.clear();

    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [MetricsService],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /metrics returns 200 with Prometheus text', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.payload).toContain('wms_');
  });

  it('exposes health metrics after a full detailed health check (database → memory → business)', async () => {
    const service = app.get(MetricsService);

    // health.service.ts records three components within a single detailed check;
    // re-registering the gauge per call used to throw on the 2nd component.
    expect(() => {
      service.recordHealthCheck('database', 'healthy', 5);
      service.recordHealthCheck('memory', 'healthy', 3);
      service.recordHealthCheck('business', 'unhealthy', 10);
    }).not.toThrow();

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('wms_health_status');
  });
});
