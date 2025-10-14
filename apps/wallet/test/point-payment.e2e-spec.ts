/**
 * 포인트 통합 결제 E2E 테스트
 *
 * 명세서 6장 테스트 시나리오 구현:
 * 1. 포인트 전액 결제 → CAPTURED, attempt 없음
 * 2. 포인트 + 카드 혼합 → CAPTURED
 * 3. 포인트 + BNPL 혼합 → AUTHORIZED
 * 4. 포인트 부족 → 에러
 * 5. 전액 환불 → REFUNDED
 * 6. 부분 환불 → PARTIALLY_REFUNDED
 * 7. 비율 계산 정확성
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '@app/db';
import { walletSchema } from '../src/shared/database/schema';
import { eq } from 'drizzle-orm';
import * as schema from '../src/shared/database/schema';
import { generateUUIDv7 } from '../src/shared/utils/id-generator';

describe('포인트 통합 결제 (E2E)', () => {
  let app: INestApplication;
  let db: DbService<typeof walletSchema>;
  let testCustomerId: string;
  let testPartnerId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = moduleFixture.get<DbService<typeof walletSchema>>(DbService);

    // 테스트용 고객 및 파트너 생성
    testCustomerId = '1'; // 실제로는 user-service에서 가져와야 함

    // partners 테이블에 테스트 데이터 삽입 (존재하지 않는 경우)
    const existingPartner = await db.db.query.partners.findFirst({
      where: eq(schema.partners.id, 1),
    });

    if (!existingPartner) {
      await db.db.insert(schema.partners).values({
        id: 1,
        mallId: 'test_mall_1',
        memberId: testCustomerId,
        name: 'Test Partner',
        referralCode: 'TEST001',
      });
    }

    testPartnerId = 1;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. 포인트 전액 결제', () => {
    it('포인트로만 결제하면 CAPTURED 상태가 되고 attempt가 없어야 함', async () => {
      // Given: 10,000원 결제, 10,000 포인트 보유
      const amount = 10000;

      // 포인트 충전 (테스트 데이터)
      await db.db.insert(schema.pointEvents).values({
        partnerId: testPartnerId,
        eventType: 'EARN',
        amount: 10000,
        reason: 'TEST',
        memo: 'E2E 테스트용 포인트',
      });

      // Intent 생성
      const intentId = generateUUIDv7();
      await db.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testCustomerId,
        amount,
        totalAmount: String(amount),
        finalAmount: String(amount),
        status: 'PENDING',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });

      // When: 포인트 전액으로 결제 승인
      // Provider는 TOSS를 사용하되, usePoints가 전액이면 자동으로 포인트 전액 결제가 됨
      const response = await request(app.getHttpServer())
        .post(`/v2/payments/intents/${intentId}/authorize`)
        .send({
          provider: 'TOSS',
          paymentKey: 'test_key_' + Date.now(),
          usePoints: 10000, // 전액 포인트 사용
        });

      // 디버깅: 응답 확인
      if (response.status !== 200) {
        console.log('Response status:', response.status);
        console.log('Response body:', JSON.stringify(response.body, null, 2));
      }

      expect(response.status).toBe(200);

      // Then
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('CAPTURED');
      expect(response.body.breakdown.finalAmount).toBe(0);
      expect(response.body.breakdown.pointsUsed).toBe(10000);

      // Intent 상태 확인
      const intent = await db.db.query.paymentIntents.findFirst({
        where: eq(schema.paymentIntents.id, intentId),
      });

      expect(intent?.status).toBe('CAPTURED');
      expect(intent?.capturedAt).toBeTruthy();
      expect(Number(intent?.discountsTotal)).toBe(10000);

      // Attempt가 없어야 함
      const attempts = await db.db.query.paymentAttempts.findMany({
        where: eq(schema.paymentAttempts.intentId, intentId),
      });

      expect(attempts.length).toBe(0);
    });

    it('포인트가 부족하면 에러가 발생해야 함', async () => {
      // Given: 50,000원 결제, 1,000 포인트만 보유
      const amount = 50000;

      const intentId = generateUUIDv7();
      await db.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testCustomerId,
        amount,
        totalAmount: String(amount),
        finalAmount: String(amount),
        status: 'PENDING',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });

      // When/Then: 50,000 포인트 사용 시도 (부족)
      await request(app.getHttpServer())
        .post(`/v2/payments/intents/${intentId}/authorize`)
        .send({
          provider: 'TOSS',
          paymentKey: 'test_key',
          usePoints: 50000,
        })
        .expect(400);
    });
  });

  describe('2. 포인트 + 현금 혼합 결제', () => {
    it('포인트 + 카드로 결제하면 CAPTURED 상태가 되어야 함', async () => {
      // Given: 30,000원 결제, 5,000 포인트 사용
      const amount = 30000;
      const usePoints = 5000;

      // 포인트 충전
      await db.db.insert(schema.pointEvents).values({
        partnerId: testPartnerId,
        eventType: 'EARN',
        amount: 10000,
        reason: 'TEST',
        memo: 'E2E 테스트용 포인트',
      });

      const intentId = generateUUIDv7();
      await db.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testCustomerId,
        amount,
        totalAmount: String(amount),
        finalAmount: String(amount),
        status: 'PENDING',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });

      // When: 포인트 + 카드 결제
      const response = await request(app.getHttpServer())
        .post(`/v2/payments/intents/${intentId}/authorize`)
        .send({
          provider: 'TOSS',
          paymentKey: 'test_payment_key_12345',
          usePoints,
        })
        .expect(200);

      // Then
      expect(response.body.success).toBe(true);
      expect(response.body.breakdown.totalAmount).toBe(30000);
      expect(response.body.breakdown.pointsUsed).toBe(5000);
      expect(response.body.breakdown.finalAmount).toBe(25000);

      // Intent 확인
      const intent = await db.db.query.paymentIntents.findFirst({
        where: eq(schema.paymentIntents.id, intentId),
      });

      expect(Number(intent?.finalAmount)).toBe(25000);
      expect(Number(intent?.discountsTotal)).toBe(5000);

      // Attempt 확인 (finalAmount로 결제됨)
      const attempt = await db.db.query.paymentAttempts.findFirst({
        where: eq(schema.paymentAttempts.intentId, intentId),
      });

      expect(attempt).toBeTruthy();
      expect(Number(attempt?.amount)).toBe(25000);
    });
  });

  describe('3. 환불 처리', () => {
    let testIntentId: string;

    beforeEach(async () => {
      // 테스트용 결제 생성 (30,000원 결제, 10,000 포인트 사용, 20,000 현금)
      testIntentId = generateUUIDv7();

      // 포인트 충전
      const earnResult = await db.db
        .insert(schema.pointEvents)
        .values({
          partnerId: testPartnerId,
          eventType: 'EARN',
          amount: 10000,
          reason: 'TEST',
          memo: '환불 테스트용',
        })
        .returning();

      await db.db.insert(schema.paymentIntents).values({
        id: testIntentId,
        customerId: testCustomerId,
        amount: 30000,
        totalAmount: '30000',
        discounts: [
          {
            type: 'POINTS',
            amount: 10000,
            pointEventId: earnResult[0].id,
            appliedAt: new Date(),
          },
        ] as any,
        discountsTotal: '10000',
        finalAmount: '20000',
        status: 'CAPTURED',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        capturedAt: new Date(),
      });

      // Attempt 생성
      await db.db.insert(schema.paymentAttempts).values({
        id: generateUUIDv7(),
        intentId: testIntentId,
        provider: 'TOSS',
        amount: 20000,
        status: 'CAPTURED',
        transactionId: 'test_txn_12345',
      });
    });

    it('전액 환불 시 REFUNDED 상태가 되어야 함', async () => {
      // When: 전액 환불
      const response = await request(app.getHttpServer())
        .post(`/v2/payments/${testIntentId}/refund`)
        .send({
          reason: 'CUSTOMER_REQUEST',
        })
        .expect(200);

      // Then
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('REFUNDED');
      expect(response.body.refunded.total).toBe(30000);
      expect(response.body.refunded.points).toBe(10000);
      expect(response.body.refunded.cash).toBe(20000);

      // Intent 상태 확인
      const intent = await db.db.query.paymentIntents.findFirst({
        where: eq(schema.paymentIntents.id, testIntentId),
      });

      expect(intent?.status).toBe('REFUNDED');
    });

    it('부분 환불 시 PARTIALLY_REFUNDED 상태가 되어야 함', async () => {
      // When: 15,000원 부분 환불 (50%)
      const response = await request(app.getHttpServer())
        .post(`/v2/payments/${testIntentId}/refund`)
        .send({
          amount: 15000,
          reason: 'PARTIAL_CANCEL',
        })
        .expect(200);

      // Then
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('PARTIALLY_REFUNDED');
      expect(response.body.refunded.total).toBe(15000);

      // 비율 계산: 15000/30000 = 0.5
      // 포인트: floor(10000 * 0.5) = 5000
      // 현금: 15000 - 5000 = 10000
      expect(response.body.refunded.points).toBe(5000);
      expect(response.body.refunded.cash).toBe(10000);

      // Intent 상태 확인
      const intent = await db.db.query.paymentIntents.findFirst({
        where: eq(schema.paymentIntents.id, testIntentId),
      });

      expect(intent?.status).toBe('PARTIALLY_REFUNDED');
      expect(Number(intent?.refundedAmount)).toBe(15000);
    });

    it('비율 계산이 정확해야 함 (소수점 버림)', async () => {
      // Given: 10,000원 결제, 3,000 포인트 사용
      const specialIntentId = generateUUIDv7();

      await db.db.insert(schema.paymentIntents).values({
        id: specialIntentId,
        customerId: testCustomerId,
        amount: 10000,
        totalAmount: '10000',
        discounts: [
          {
            type: 'POINTS',
            amount: 3000,
            pointEventId: 1,
            appliedAt: new Date(),
          },
        ] as any,
        discountsTotal: '3000',
        finalAmount: '7000',
        status: 'CAPTURED',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        capturedAt: new Date(),
      });

      await db.db.insert(schema.paymentAttempts).values({
        id: generateUUIDv7(),
        intentId: specialIntentId,
        provider: 'TOSS',
        amount: 7000,
        status: 'CAPTURED',
        transactionId: 'test_txn_special',
      });

      // When: 3,333원 환불 (비율 = 3333/10000 = 0.3333)
      const response = await request(app.getHttpServer())
        .post(`/v2/payments/${specialIntentId}/refund`)
        .send({
          amount: 3333,
          reason: 'TEST',
        })
        .expect(200);

      // Then: floor(3000 * 0.3333) = floor(999.9) = 999
      // 현금: 3333 - 999 = 2334
      expect(response.body.refunded.points).toBe(999);
      expect(response.body.refunded.cash).toBe(2334);
      expect(response.body.refunded.total).toBe(3333);
    });
  });

  describe('4. 트랜잭션 일관성', () => {
    it('포인트 차감 후 외부 결제 실패 시 포인트도 롤백되어야 함', async () => {
      // Given: 초기 포인트 잔액 확인
      const initialBalance = await db.db
        .select()
        .from(schema.pointEvents)
        .where(eq(schema.pointEvents.partnerId, testPartnerId));

      const intentId = generateUUIDv7();
      await db.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testCustomerId,
        amount: 50000,
        totalAmount: '50000',
        finalAmount: '50000',
        status: 'PENDING',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });

      // When: 잘못된 paymentKey로 결제 시도 (실패 예상)
      try {
        await request(app.getHttpServer())
          .post(`/v2/payments/intents/${intentId}/authorize`)
          .send({
            provider: 'TOSS',
            paymentKey: 'invalid_key',
            usePoints: 5000,
          });
      } catch (error) {
        // 예상된 실패
      }

      // Then: 포인트 잔액이 그대로여야 함 (롤백됨)
      const finalBalance = await db.db
        .select()
        .from(schema.pointEvents)
        .where(eq(schema.pointEvents.partnerId, testPartnerId));

      expect(finalBalance.length).toBe(initialBalance.length);
    });
  });
});
