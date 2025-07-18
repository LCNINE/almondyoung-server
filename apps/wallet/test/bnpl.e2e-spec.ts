// apps/wallet/test/bnpl.e2e-spec.ts
import * as request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PaymsModule } from '../src/payms.module';
import * as path from 'path';

import * as fs from 'fs';
import { ulid } from 'ulid';

describe('BNPL 통합테스트 (Express + supertest)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PaymsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('BNPL 전체 플로우', async () => {
    // 1번만 생성!
    const userId = `${Date.now()}`;
    const transactionId = ulid();
    const invoiceDesc = `${ulid()}`;

    console.log('테스트에서 생성한 userId:', userId);

    // 1. 계좌 등록 – memberId 보내지 않기, 응답에서 추출
    const paymentMethodId = ulid();

    const registerRes = await request(app.getHttpServer())
      .post('/bnpl/accounts')
      .send({
        userId,

        creditLimit: 500000,
        approvedLimit: 300000,
        billingCycleDay: 25,
        termsUrl: 'https://example.com/terms',
      })
      .expect(201);

    const memberId = registerRes.body.hmsResult.member.memberId; // ← 이렇게 꺼내야 함
    console.log('서버가 반환한 memberId:', memberId);

    // 2. 동의자료 제출
    const filePath = path.resolve(__dirname, 'test.png');
    if (!fs.existsSync(filePath)) {
      throw new Error(`Test file not found: ${filePath}`);
    }
    await request(app.getHttpServer())
      .post('/bnpl/agreements')
      .field('memberId', memberId)
      .attach('agreementFile', filePath)
      .expect(201);

    // 3. 청구서 생성 (변경 없음)
    const invoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        userId,
        amount: '100000',
        currency: 'KRW',
        invoiceType: 'PRODUCT',
        description: invoiceDesc,
      })
      .expect(201);
    const invoiceId = invoiceRes.body.id;

    // 4. 출금신청 (변경 없음)
    await request(app.getHttpServer())
      .post('/bnpl/test/withdrawal')
      .send({
        transactionId,
        memberId, // ← 같은 값 재사용
        paymentDate: '20250717',
        callAmount: 100000,
        invoiceId,
      })
      .expect(201);
  }, 10000);

  afterAll(async () => {
    await app.close();
  });
});
