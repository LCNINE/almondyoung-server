import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { OrderCollectionFailuresController } from './order-collection-failures.controller';
import { OrderCollectionFailureService } from '../services/order-collection/order-collection-failure.service';
import { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';

describe('GET /adapter/order-collection-failures/summary', () => {
  let app: INestApplication;
  const failures = {
    summarizeQuarantined: jest.fn().mockResolvedValue({ quarantined: 3, oldestCreatedAt: '2026-10-01T00:00:00.000Z' }),
    get: jest.fn(),
    inspect: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrderCollectionFailuresController],
      providers: [
        { provide: OrderCollectionFailureService, useValue: failures },
        { provide: OrderPollerOrchestrator, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it(':id 라우트가 아니라 요약으로 간다', async () => {
    const res = await request(app.getHttpServer()).get('/adapter/order-collection-failures/summary?channel=medusa');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ quarantined: 3, oldestCreatedAt: '2026-10-01T00:00:00.000Z' });
    expect(failures.summarizeQuarantined).toHaveBeenCalledWith({ channel: 'medusa' });
  });
});
