import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WmsModule } from '../src/wms.module';
import { v4 as uuid } from 'uuid';

describe('Movement - moveImmediately (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WmsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should move within same warehouse in batch', async () => {
    // 테스트를 위한 선행 데이터는 env-setup.ts 혹은 별도 seed에 의존
    const warehouseId = process.env.TEST_WAREHOUSE_ID as string;
    const skuId = process.env.TEST_SKU_ID as string;
    const fromLocationId = process.env.TEST_FROM_LOCATION_ID as string;
    const toLocationId = process.env.TEST_TO_LOCATION_ID as string;
    const actorId = uuid();

    const res = await request(app.getHttpServer())
      .post('/wms/movement/move')
      .send({
        warehouseId,
        actorId,
        lines: [
          { skuId, fromLocationId, toLocationId, quantity: 1, memo: 'e2e move' },
        ],
      });

    expect(res.status).toBe(201 || 200);
    expect(res.body.job).toBeDefined();
    expect(Array.isArray(res.body.lines)).toBeTruthy();
  });
});


