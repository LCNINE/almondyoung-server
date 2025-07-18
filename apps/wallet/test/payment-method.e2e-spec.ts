import * as request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PaymsModule } from '../src/payms.module';

/**
 * PaymentMethod 통합 테스트 (Express + Supertest)
 *
 * 플로우:
 * 1. 결제수단 생성 (status=PENDING)
 * 2. 결제수단 정보 수정
 * 3. 결제수단 비활성화(INACTIVE)
 */

describe('PaymentMethodController (e2e)', () => {
  let app: INestApplication;
  let userId: string;
  let paymentMethodId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PaymsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('결제수단 생성 → 수정 → 비활성화', async () => {
    userId = `${Date.now()}`;

    // 1) 생성
    const createRes = await request(app.getHttpServer())
      .post('/payment-methods')
      .send({
        userId,
        methodType: 'BNPL',
        methodName: 'BNPL 테스트',
        institutionCode: 'ALMOND001',
        isDefault: true,
      })
      .expect(201);

    paymentMethodId = createRes.body.id;
    expect(createRes.body.status).toBe('PENDING');

    // 2) 수정
    const updateRes = await request(app.getHttpServer())
      .patch(`/payment-methods/${paymentMethodId}`)
      .send({
        methodName: 'BNPL 테스트(수정)',
        isDefault: true,
      })
      .expect(200);

    expect(updateRes.body.methodName).toBe('BNPL 테스트(수정)');

    // 3) 비활성화
    const deactivateRes = await request(app.getHttpServer())
      .delete(`/payment-methods/${paymentMethodId}`)
      .expect(200);

    expect(deactivateRes.body.status).toBe('INACTIVE');
  }, 10000);

  afterAll(async () => {
    await app.close();
  });
});
