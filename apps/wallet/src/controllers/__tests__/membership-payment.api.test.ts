// controllers/__tests__/membership-payment.api.test.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DbService } from '@app/db';
import { PaymentController } from '../payment.controller';
import { PaymentService } from '../../services/payment.service';
import { PaymentMethodService } from '../../services/payment-method.service';
import { RefundService } from '../../services/refund.service';
import { IdempotencyService } from '../../services/idempotency.service';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';

/**
 * 멤버십 정기결제 API 테스트
 *
 * 테스트 시나리오:
 * 1. 등록된 HMS 카드로 멤버십 정기결제 실행
 * 2. PaymentEvents 테이블에 정확한 데이터 저장 확인
 * 3. metadata와 pricingSnapshot 저장 확인
 */
describe('Membership Payment API Test', () => {
  let app: INestApplication;
  let dbService: DbService<typeof schema>;
  let paymentController: PaymentController;

  // 실제 DB에 저장된 테스트 데이터
  const TEST_USER_ID = 'hms-test-user-1757221534583';
  const TEST_PAYMENT_METHOD_ID = '01K4H91FY4R8PYYXHBDV21DERQ';
  const TEST_HMS_MEMBER_ID = '0MW8AEQ47XA8B';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        PaymentService,
        PaymentMethodService,
        RefundService,
        IdempotencyService,
        {
          provide: DbService,
          useValue: {
            // 실제 DB 연결 (테스트 환경)
            db: global.testDb, // 실제 테스트 DB 인스턴스
          },
        },
        // 실제 어댑터들도 주입 (Mock 환경에서 동작)
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dbService = moduleFixture.get<DbService<typeof schema>>(DbService);
    paymentController = moduleFixture.get<PaymentController>(PaymentController);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /payments/membership - 멤버십 정기결제', () => {
    it('등록된 HMS 카드로 멤버십 결제가 성공해야 함', async () => {
      // Given: 멤버십 결제 요청 데이터
      const membershipPaymentRequest = {
        userId: TEST_USER_ID,
        paymentMethodId: TEST_PAYMENT_METHOD_ID,
        amount: 29900, // 월 멤버십 요금
        currency: 'KRW',
        sessionId: `session_${Date.now()}`,
        metadata: {
          subscriptionType: 'PREMIUM_MONTHLY',
          billingCycle: 'MONTHLY',
          planId: 'premium-monthly-29900',
          startDate: new Date().toISOString(),
          source: 'api',
        },
        pricingSnapshot: {
          originalAmount: 39900,
          discountAmount: 10000,
          finalAmount: 29900,
          couponId: 'WELCOME10K',
          discountRate: 25.06,
        },
      };

      // When: 멤버십 결제 API 호출
      const response = await request(app.getHttpServer())
        .post('/payments/membership')
        .send(membershipPaymentRequest)
        .expect(200);

      // Then: 응답 검증
      expect(response.body).toMatchObject({
        success: true,
        paymentEventId: expect.any(String),
        transactionId: expect.any(String),
        amount: 29900,
        status: expect.stringMatching(/^(AUTHORIZED|CAPTURED)$/),
        processedAt: expect.any(String),
      });

      console.log(
        '✅ 멤버십 결제 응답:',
        JSON.stringify(response.body, null, 2),
      );

      // PaymentEvents 테이블 확인
      const paymentEvents = await dbService.db
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, response.body.paymentEventId));

      expect(paymentEvents).toHaveLength(1);

      const paymentEvent = paymentEvents[0];
      console.log(
        '✅ 저장된 PaymentEvent:',
        JSON.stringify(paymentEvent, null, 2),
      );

      // PaymentEvents 필드 검증
      expect(paymentEvent).toMatchObject({
        id: response.body.paymentEventId,
        paymentMethodId: TEST_PAYMENT_METHOD_ID,
        amount: 29900,
        status: expect.stringMatching(/^(AUTHORIZED|CAPTURED)$/),
        actor: 'USER',
      });

      // metadata 검증 (JSON 파싱)
      const savedMetadata = JSON.parse(paymentEvent.metadata as string);
      expect(savedMetadata).toMatchObject({
        paymentPurpose: 'SUBSCRIPTION',
        isSubscriptionPayment: true,
        source: 'api',
        subscriptionType: 'PREMIUM_MONTHLY',
        billingCycle: 'MONTHLY',
        planId: 'premium-monthly-29900',
      });

      // pricingSnapshot 검증 (JSON 파싱)
      const savedPricingSnapshot = JSON.parse(
        paymentEvent.pricingSnapshot as string,
      );
      expect(savedPricingSnapshot).toMatchObject({
        originalAmount: 39900,
        discountAmount: 10000,
        finalAmount: 29900,
        couponId: 'WELCOME10K',
        discountRate: 25.06,
      });

      // pgResponse 검증
      expect(paymentEvent.pgResponse).toBeDefined();
      const pgResponse = JSON.parse(paymentEvent.pgResponse as string);
      expect(pgResponse).toMatchObject({
        gateway: expect.any(String),
        approvalNumber: expect.any(String),
        paymentDate: expect.any(String),
      });

      console.log('✅ 모든 DB 저장 검증 완료!');
    });

    it('잘못된 결제수단 ID로 요청 시 400 에러가 발생해야 함', async () => {
      const invalidRequest = {
        userId: TEST_USER_ID,
        paymentMethodId: 'invalid-payment-method-id',
        amount: 29900,
        currency: 'KRW',
      };

      const response = await request(app.getHttpServer())
        .post('/payments/membership')
        .send(invalidRequest)
        .expect(400);

      expect(response.body.message).toContain('결제수단을 찾을 수 없습니다');
    });

    it('멱등성 키를 사용한 중복 요청 시 같은 결과를 반환해야 함', async () => {
      const idempotencyKey = `idem_${Date.now()}`;
      const paymentRequest = {
        userId: TEST_USER_ID,
        paymentMethodId: TEST_PAYMENT_METHOD_ID,
        amount: 19900,
        currency: 'KRW',
        sessionId: `session_${Date.now()}`,
        metadata: {
          subscriptionType: 'BASIC_MONTHLY',
          source: 'api',
        },
        pricingSnapshot: {
          originalAmount: 19900,
          finalAmount: 19900,
        },
      };

      // 첫 번째 요청
      const firstResponse = await request(app.getHttpServer())
        .post('/payments/membership')
        .set('idempotency-key', idempotencyKey)
        .send(paymentRequest)
        .expect(200);

      // 두 번째 요청 (같은 멱등성 키)
      const secondResponse = await request(app.getHttpServer())
        .post('/payments/membership')
        .set('idempotency-key', idempotencyKey)
        .send(paymentRequest)
        .expect(200);

      // 같은 결과 반환 확인
      expect(firstResponse.body.paymentEventId).toBe(
        secondResponse.body.paymentEventId,
      );
      expect(firstResponse.body.transactionId).toBe(
        secondResponse.body.transactionId,
      );

      console.log('✅ 멱등성 테스트 완료');
    });
  });

  describe('DB 저장 상세 검증', () => {
    it('PaymentEvents 테이블의 모든 필드가 올바르게 저장되어야 함', async () => {
      // 최신 PaymentEvent 조회
      const latestEvents = await dbService.db
        .select()
        .from(schema.paymentEvents)
        .orderBy(schema.paymentEvents.createdAt)
        .limit(1);

      expect(latestEvents).toHaveLength(1);
      const event = latestEvents[0];

      // 필수 필드 존재 확인
      expect(event.id).toBeDefined();
      expect(event.paymentMethodId).toBe(TEST_PAYMENT_METHOD_ID);
      expect(event.amount).toBeGreaterThan(0);
      expect(event.status).toMatch(/^(AUTHORIZED|CAPTURED|FAILED)$/);
      expect(event.actor).toBe('USER');
      expect(event.createdAt).toBeDefined();

      // JSON 필드 파싱 가능 확인
      expect(() => JSON.parse(event.metadata as string)).not.toThrow();
      expect(() => JSON.parse(event.pricingSnapshot as string)).not.toThrow();
      expect(() => JSON.parse(event.pgResponse as string)).not.toThrow();

      console.log('✅ PaymentEvents 필드 검증 완료');
    });

    it('등록된 결제수단 정보가 올바른지 확인', async () => {
      // PaymentMethod 조회
      const paymentMethods = await dbService.db
        .select()
        .from(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, TEST_PAYMENT_METHOD_ID));

      expect(paymentMethods).toHaveLength(1);
      const method = paymentMethods[0];

      expect(method).toMatchObject({
        id: TEST_PAYMENT_METHOD_ID,
        userId: TEST_USER_ID,
        methodType: 'CARD',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
      });

      // CardMethod 조회
      const cardMethods = await dbService.db
        .select()
        .from(schema.cardMethod)
        .where(eq(schema.cardMethod.id, TEST_PAYMENT_METHOD_ID));

      expect(cardMethods).toHaveLength(1);
      const card = cardMethods[0];

      expect(card).toMatchObject({
        id: TEST_PAYMENT_METHOD_ID,
        hmsMemberId: TEST_HMS_MEMBER_ID,
        methodType: 'CARD',
        pgToken: TEST_HMS_MEMBER_ID,
        billingKey: TEST_HMS_MEMBER_ID,
      });

      console.log('✅ 결제수단 정보 검증 완료');
    });
  });
});
