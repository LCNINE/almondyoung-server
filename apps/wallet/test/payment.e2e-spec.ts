import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { AppModule } from '../src/app.module';
import * as schema from '../src/shared/database/schema';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';

describe('Payment E2E', () => {
  let app: INestApplication;
  let db: DbService<typeof schema>;

  const testUserId = 'e2e_test_user';
  let testPaymentMethodId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = moduleFixture.get<DbService<typeof schema>>(DbService);

    // 테스트 데이터 정리
    await cleanupTestData();

    // 테스트용 결제수단 생성
    const [paymentMethod] = await db.db
      .insert(schema.paymentMethod)
      .values({
        userId: testUserId,
        methodType: 'CARD',
        methodName: 'E2E 테스트 카드',
        status: 'ACTIVE',
        paymentPurpose: 'BOTH',
      })
      .returning();

    testPaymentMethodId = paymentMethod.id;
  });

  afterAll(async () => {
    // 환불 이벤트 확인을 위해 임시로 cleanup 비활성화
    // await cleanupTestData();
    await app.close();
  });

  async function cleanupTestData() {
    try {
      // 테스트 사용자의 모든 데이터 삭제 (올바른 순서로)
      const testUserSessions = await db.db
        .select({ id: schema.paymentSessions.id })
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.userId, testUserId));

      for (const session of testUserSessions) {
        // 1. 환불 이벤트 삭제
        const paymentEvents = await db.db
          .select({ id: schema.paymentEvents.id })
          .from(schema.paymentEvents)
          .where(eq(schema.paymentEvents.sessionId, session.id));

        for (const event of paymentEvents) {
          await db.db
            .delete(schema.refundEvents)
            .where(eq(schema.refundEvents.paymentEventId, event.id));
        }

        // 2. 세션 이벤트 삭제
        await db.db
          .delete(schema.paymentSessionEvents)
          .where(eq(schema.paymentSessionEvents.paymentSessionId, session.id));

        // 3. 결제 이벤트 삭제
        await db.db
          .delete(schema.paymentEvents)
          .where(eq(schema.paymentEvents.sessionId, session.id));
      }

      // 4. 세션 삭제
      await db.db
        .delete(schema.paymentSessions)
        .where(eq(schema.paymentSessions.userId, testUserId));

      // 5. 결제수단 삭제
      await db.db
        .delete(schema.paymentMethod)
        .where(eq(schema.paymentMethod.userId, testUserId));
    } catch (error) {
      console.log('테스트 데이터 정리 실패:', error.message);
    }
  }

  describe('/payments (POST)', () => {
    it('일반 결제 성공', () => {
      return request(app.getHttpServer())
        .post('/payments/process')
        .send({
          userId: testUserId,
          paymentMethodId: testPaymentMethodId,
          amount: 50000,
          currency: 'KRW',
          metadata: {
            paymentPurpose: 'PURCHASE',
            productName: 'E2E 테스트 상품',
          },
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.paymentEventId).toBeDefined();
          expect(res.body.sessionId).toBeDefined(); // 세션 기반 리팩토링 확인
          expect(res.body.status).toBe('CAPTURED');
          expect(res.body.amount).toBe(50000);
          expect(res.body.createdAt).toBeDefined();
        });
    });

    it('세션 ID 제공 시 해당 세션 사용', async () => {
      // 먼저 세션 생성
      const sessionResponse = await request(app.getHttpServer())
        .post('/payments/session')
        .send({
          userId: testUserId,
          amount: 30000,
          currency: 'KRW',
          metadata: {
            paymentPurpose: 'PURCHASE',
          },
        })
        .expect(201);

      const sessionId = sessionResponse.body.sessionId;

      // 생성된 세션으로 결제
      return request(app.getHttpServer())
        .post('/payments/process')
        .send({
          userId: testUserId,
          paymentMethodId: testPaymentMethodId,
          sessionId: sessionId, // 기존 세션 사용
          amount: 30000,
          currency: 'KRW',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.sessionId).toBe(sessionId); // 동일한 세션 ID
          expect(res.body.status).toBe('CAPTURED');
        });
    });

    it('존재하지 않는 결제수단으로 결제 시 400 에러', () => {
      return request(app.getHttpServer())
        .post('/payments/process')
        .send({
          userId: testUserId,
          paymentMethodId: 'nonexistent_method',
          amount: 50000,
          currency: 'KRW',
        })
        .expect(404)
        .expect((res) => {
          expect(res.body.message).toContain('결제수단을 찾을 수 없습니다');
        });
    });

    it('필수 필드 누락 시 400 에러', () => {
      return request(app.getHttpServer())
        .post('/payments/process')
        .send({
          userId: testUserId,
          // paymentMethodId 누락
          amount: 50000,
          currency: 'KRW',
        })
        .expect(400);
    });
  });

  describe('/payments/recurring (POST)', () => {
    it('정기결제 성공', () => {
      return request(app.getHttpServer())
        .post('/payments/recurring')
        .send({
          userId: testUserId,
          paymentMethodId: testPaymentMethodId,
          amount: 29900,
          currency: 'KRW',
          metadata: {
            paymentPurpose: 'SUBSCRIPTION',
            billingCycle: 'MONTHLY',
          },
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.paymentEventId).toBeDefined();
          expect(res.body.sessionId).toBeDefined(); // 세션 자동 생성 확인
          expect(res.body.status).toBe('CAPTURED');
          expect(res.body.amount).toBe(29900);
        });
    });
  });

  describe('/payments/refund (POST)', () => {
    let paymentEventId: string;
    let sessionId: string;

    beforeAll(async () => {
      // 환불 테스트용 결제 실행
      const paymentResponse = await request(app.getHttpServer())
        .post('/payments/process')
        .send({
          userId: testUserId,
          paymentMethodId: testPaymentMethodId,
          amount: 100000,
          currency: 'KRW',
          metadata: {
            paymentPurpose: 'PURCHASE',
            productName: '환불 테스트 상품',
          },
        })
        .expect(201);

      paymentEventId = paymentResponse.body.paymentEventId;
      sessionId = paymentResponse.body.sessionId;
    });

    it('부분 환불 성공', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments/refund')
        .send({
          paymentEventId: paymentEventId,
          amount: 30000, // 부분 환불
          reason: 'E2E 부분 환불 테스트',
        })
        .expect(201);

      expect(response.body.refundEventId).toBeDefined();
      expect(response.body.sessionId).toBe(sessionId);
      expect(response.body.refundedAmount).toBe(30000);
      expect(response.body.status).toBe('COMPLETED');

      // DB에 환불 이벤트가 실제로 저장되었는지 확인
      const refundEvents = await db.db
        .select()
        .from(schema.refundEvents)
        .where(eq(schema.refundEvents.id, response.body.refundEventId));

      expect(refundEvents).toHaveLength(1);
      expect(refundEvents[0].amount).toBe('30000.0000');
      expect(refundEvents[0].status).toBe('COMPLETED');

      console.log(
        '✅ 환불 이벤트가 DB에 정상적으로 저장되었습니다:',
        refundEvents[0],
      );
    });

    it('나머지 환불 성공 (전액 환불 완료)', () => {
      return request(app.getHttpServer())
        .post('/payments/refund')
        .send({
          paymentEventId: paymentEventId,
          amount: 70000, // 나머지 환불
          reason: 'E2E 나머지 환불 테스트',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.refundEventId).toBeDefined();
          expect(res.body.sessionId).toBe(sessionId);
          expect(res.body.refundedAmount).toBe(70000);
          expect(res.body.status).toBe('COMPLETED');
        });
    });

    it('환불 금액 초과 시 400 에러', async () => {
      // 새로운 결제 생성
      const newPaymentResponse = await request(app.getHttpServer())
        .post('/payments/process')
        .send({
          userId: testUserId,
          paymentMethodId: testPaymentMethodId,
          amount: 10000,
          currency: 'KRW',
        })
        .expect(201);

      // 원본 금액보다 큰 환불 시도
      return request(app.getHttpServer())
        .post('/payments/refund')
        .send({
          paymentEventId: newPaymentResponse.body.paymentEventId,
          amount: 20000, // 원본 10,000원보다 큰 금액
          reason: '초과 환불 테스트',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain(
            '환불 금액이 원본 결제 금액을 초과합니다',
          );
        });
    });

    it('존재하지 않는 결제 이벤트 환불 시 404 에러', () => {
      return request(app.getHttpServer())
        .post('/payments/refund')
        .send({
          paymentEventId: 'nonexistent_event',
          amount: 10000,
          reason: '존재하지 않는 이벤트 환불 테스트',
        })
        .expect(404)
        .expect((res) => {
          expect(res.body.message).toContain('결제 이벤트를 찾을 수 없습니다');
        });
    });
  });

  describe('/payments/session (POST)', () => {
    it('결제 세션 생성 성공', () => {
      return request(app.getHttpServer())
        .post('/payments/session')
        .send({
          userId: testUserId,
          amount: 50000,
          currency: 'KRW',
          metadata: {
            paymentPurpose: 'PURCHASE',
            productName: '세션 테스트 상품',
          },
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.sessionId).toBeDefined();
          expect(res.body.status).toBe('PENDING');
          expect(res.body.checkout.url).toBeDefined();
          expect(res.body.metadata.paymentPurpose).toBe('PURCHASE');
        });
    });
  });

  describe('세션 상태 확인', () => {
    it('부분 환불 후 세션 상태가 PARTIALLY_REFUNDED', async () => {
      // 결제 실행
      const paymentResponse = await request(app.getHttpServer())
        .post('/payments/process')
        .send({
          userId: testUserId,
          paymentMethodId: testPaymentMethodId,
          amount: 50000,
          currency: 'KRW',
        })
        .expect(201);

      // 부분 환불
      await request(app.getHttpServer())
        .post('/payments/refund')
        .send({
          paymentEventId: paymentResponse.body.paymentEventId,
          amount: 20000,
          reason: '부분 환불',
        })
        .expect(201);

      // DB에서 세션 상태 직접 확인
      const [session] = await db.db
        .select()
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, paymentResponse.body.sessionId));

      expect(session.status).toBe('PARTIALLY_REFUNDED');
      expect(Number(session.refundedAmount)).toBe(20000);
    });

    it('전액 환불 후 세션 상태가 REFUNDED', async () => {
      // 결제 실행
      const paymentResponse = await request(app.getHttpServer())
        .post('/payments/process')
        .send({
          userId: testUserId,
          paymentMethodId: testPaymentMethodId,
          amount: 30000,
          currency: 'KRW',
        })
        .expect(201);

      // 전액 환불
      await request(app.getHttpServer())
        .post('/payments/refund')
        .send({
          paymentEventId: paymentResponse.body.paymentEventId,
          // amount 없음 = 전액 환불
          reason: '전액 환불',
        })
        .expect(201);

      // DB에서 세션 상태 직접 확인
      const [session] = await db.db
        .select()
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, paymentResponse.body.sessionId));

      expect(session.status).toBe('REFUNDED');
      expect(Number(session.refundedAmount)).toBe(30000);
    });
  });
});
