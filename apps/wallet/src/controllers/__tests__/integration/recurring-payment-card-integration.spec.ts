import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as request from 'supertest';
import { DbService } from '@app/db';
import { EventsModule } from '@app/events';
import * as schema from '../../shared/database/schema';
import { RecurringPaymentController } from '../recurring-payment.controller';
import { RecurringPaymentService } from '../../services/recurring-payment.service';
import { RecurringPaymentLoggerService } from '../../services/recurring-payment-logger.service';
import { PaymentService } from '../../services/payment.service';
import { PaymentMethodService } from '../../services/payment-method.service';
import { PaymentStrategyFactory } from '../../factories/payment-strategy.factory';
import { CardStrategy } from '../../strategies/card.strategy';
import { HmsCardPaymentAdapter } from '../../adapters/hms-card-payment.adapter';
import { HMS_CARD_PAYMENT_ADAPTER } from '../../shared/tokens/gateway.tokens';
import { RecurringPaymentExceptionFilter } from '../../shared/filters/recurring-payment-exception.filter';
import { readFileSync } from 'fs';
import { join } from 'path';
import { eq } from 'drizzle-orm';

/**
 * 신용카드 기반 구독 정기결제 통합 테스트
 *
 * 테스트 시나리오:
 * 1. HMS 카드 등록 및 memberID 획득
 * 2. 구독 결제수단 검증
 * 3. 구독 정기결제 실행
 * 4. 결제 상태 조회
 * 5. 에러 시나리오 테스트
 */
describe('RecurringPayment Card Integration Tests', () => {
  let app: INestApplication;
  let dbService: DbService<typeof schema>;
  let recurringPaymentService: RecurringPaymentService;
  let paymentMethodService: PaymentMethodService;
  let hmsCardAdapter: HmsCardPaymentAdapter;

  // 로컬 멤버십 데이터
  let membershipData: any;

  // 테스트용 사용자 및 결제수단 ID
  let testUserId: string;
  let testPaymentMethodId: string;
  let testHmsMemberId: string;

  beforeAll(async () => {
    // 로컬 멤버십 데이터 로드
    const membershipDbPath = join(
      __dirname,
      '../../../test/membership-db.json',
    );
    membershipData = JSON.parse(readFileSync(membershipDbPath, 'utf-8'));

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.TEST_DATABASE_URL ||
              'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: { ...schema },
        }),
        EventsModule,
      ],
      controllers: [RecurringPaymentController],
      providers: [
        RecurringPaymentService,
        RecurringPaymentLoggerService,
        PaymentService,
        PaymentMethodService,
        PaymentStrategyFactory,
        CardStrategy,
        {
          provide: HMS_CARD_PAYMENT_ADAPTER,
          useClass: HmsCardPaymentAdapter,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new RecurringPaymentExceptionFilter());

    dbService = moduleFixture.get<DbService<typeof schema>>(DbService);
    recurringPaymentService = moduleFixture.get<RecurringPaymentService>(
      RecurringPaymentService,
    );
    paymentMethodService =
      moduleFixture.get<PaymentMethodService>(PaymentMethodService);
    hmsCardAdapter = moduleFixture.get<HmsCardPaymentAdapter>(
      HMS_CARD_PAYMENT_ADAPTER,
    );

    await app.init();

    // 테스트 데이터 초기화
    await setupTestData();
  });

  afterAll(async () => {
    // 테스트 데이터 정리
    await cleanupTestData();
    await app.close();
  });

  describe('1. HMS 카드 등록 및 memberID 획득', () => {
    it('신용카드를 HMS에 등록하고 memberID를 획득해야 한다', async () => {
      const testMember = membershipData.members[0]; // 김테스트
      const testCard = membershipData.paymentMethods[0];

      // HMS 카드 등록 요청
      const registrationRequest = {
        memberName: testCard.cardInfo.memberName,
        phone: testCard.cardInfo.phone,
        paymentNumber: testCard.cardInfo.paymentNumber,
        payerName: testCard.cardInfo.payerName,
        payerNumber: testCard.cardInfo.payerNumber,
        validYear: testCard.cardInfo.validYear,
        validMonth: testCard.cardInfo.validMonth,
      };

      console.log('HMS 카드 등록 요청:', registrationRequest);

      const registrationResult =
        await hmsCardAdapter.registerRecurringMember(registrationRequest);

      console.log('HMS 카드 등록 결과:', registrationResult);

      expect(registrationResult.success).toBe(true);
      expect(registrationResult.hmsMemberId).toBeDefined();
      expect(registrationResult.hmsMemberId).toMatch(/^HMS_/);

      // 테스트용 HMS memberID 저장
      testHmsMemberId = registrationResult.hmsMemberId!;

      console.log(`✅ HMS memberID 획득 성공: ${testHmsMemberId}`);
    });

    it('획득한 HMS memberID로 결제수단을 데이터베이스에 등록해야 한다', async () => {
      const testCard = membershipData.paymentMethods[0];

      // 결제수단 등록 (paymentPurpose: SUBSCRIPTION)
      const paymentMethodData = {
        userId: testUserId,
        methodType: 'CARD' as const,
        status: 'ACTIVE' as const,
        paymentPurpose: 'SUBSCRIPTION' as const,
        metadata: {
          registeredAt: new Date().toISOString(),
        },
      };

      // PaymentMethod 테이블에 등록
      const [createdPaymentMethod] = await dbService.db
        .insert(schema.paymentMethod)
        .values(paymentMethodData)
        .returning();

      testPaymentMethodId = createdPaymentMethod.id;

      // CardMethod 테이블에 HMS 정보 등록
      const cardMethodData = {
        id: testPaymentMethodId,
        hmsMemberId: testHmsMemberId,
        maskedCardNumber: testCard.cardInfo.maskedCardNumber,
        metadata: JSON.stringify({
          memberName: testCard.cardInfo.memberName,
          phone: testCard.cardInfo.phone,
          payerNumber: testCard.cardInfo.payerNumber,
          validYear: testCard.cardInfo.validYear,
          validMonth: testCard.cardInfo.validMonth,
          registeredAt: new Date().toISOString(),
        }),
      };

      await dbService.db.insert(schema.cardMethod).values(cardMethodData);

      console.log(`✅ 결제수단 등록 완료: ${testPaymentMethodId}`);

      // 등록 확인
      const savedPaymentMethod =
        await paymentMethodService.get(testPaymentMethodId);
      expect(savedPaymentMethod.userId).toBe(testUserId);
      expect(savedPaymentMethod.methodType).toBe('CARD');
      expect(savedPaymentMethod.paymentPurpose).toBe('SUBSCRIPTION');
    });
  });

  describe('2. 구독 결제수단 검증', () => {
    it('등록된 카드 결제수단이 구독 결제에 유효해야 한다', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring/validate-payment-method')
        .send({
          paymentMethodId: testPaymentMethodId,
          userId: testUserId,
          expectedAmount: 9900,
          performDetailedValidation: true,
        })
        .expect(200);

      console.log('결제수단 검증 응답:', response.body);

      expect(response.body.isValid).toBe(true);
      expect(response.body.paymentMethodId).toBe(testPaymentMethodId);
      expect(response.body.methodType).toBe('CARD');
      expect(response.body.paymentPurpose).toBe('SUBSCRIPTION');
      expect(response.body.hmsMemberId).toBe(testHmsMemberId);
      expect(response.body.validationDetails).toBeDefined();
    });

    it('PURCHASE 전용 결제수단은 구독 결제에 사용할 수 없어야 한다', async () => {
      // PURCHASE 전용 결제수단 생성
      const purchaseOnlyPaymentMethod = {
        userId: testUserId,
        methodType: 'CARD' as const,
        status: 'ACTIVE' as const,
        paymentPurpose: 'PURCHASE' as const,
        metadata: JSON.stringify({}),
      };

      const [createdPurchaseMethod] = await dbService.db
        .insert(schema.paymentMethod)
        .values(purchaseOnlyPaymentMethod)
        .returning();

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring/validate-payment-method')
        .send({
          paymentMethodId: createdPurchaseMethod.id,
          userId: testUserId,
          performDetailedValidation: false,
        })
        .expect(200);

      console.log('PURCHASE 전용 결제수단 검증 응답:', response.body);

      expect(response.body.isValid).toBe(false);
      expect(response.body.error).toContain('구독 결제가 허용되지 않은');
      expect(response.body.paymentPurpose).toBe('PURCHASE');

      // 테스트 데이터 정리
      await dbService.db
        .delete(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, createdPurchaseMethod.id));
    });
  });

  describe('3. 구독 정기결제 실행', () => {
    it('월간 구독 결제를 성공적으로 처리해야 한다', async () => {
      const testMember = membershipData.members[0]; // 김테스트 - 월간 구독
      const recurringPaymentRequest = {
        userId: testUserId,
        paymentMethodId: testPaymentMethodId,
        amount: testMember.subscriptionAmount, // 9900원
        currency: 'KRW',
        subscriptionType: 'monthly',
        billingCycle: testMember.billingCycle, // 30일
        discountAmount: 0,
      };

      console.log('구독 결제 요청:', recurringPaymentRequest);

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .set('idempotency-key', `test-monthly-${Date.now()}`)
        .send(recurringPaymentRequest)
        .expect(201);

      console.log('구독 결제 응답:', response.body);

      expect(response.body.success).toBe(true);
      expect(response.body.transactionId).toBeDefined();
      expect(response.body.paymentEventId).toBeDefined();
      expect(response.body.status).toMatch(/^(AUTHORIZED|CAPTURED)$/);
      expect(response.body.amount).toBe(testMember.subscriptionAmount);
      expect(response.body.processedAt).toBeDefined();
      expect(response.body.gatewayResponse).toBeDefined();

      // PaymentEvents 테이블에 기록 확인
      const [paymentEvent] = await dbService.db
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, response.body.paymentEventId))
        .limit(1);

      expect(paymentEvent).toBeDefined();
      expect(paymentEvent.amount).toBe(testMember.subscriptionAmount);
      expect(paymentEvent.status).toMatch(/^(AUTHORIZED|CAPTURED)$/);

      const metadata = JSON.parse(paymentEvent.metadata || '{}');
      expect(metadata.isSubscriptionPayment).toBe(true);
      expect(metadata.subscriptionType).toBe('monthly');
      expect(metadata.paymentPurpose).toBe('SUBSCRIPTION');
      expect(metadata.hmsMemberId).toBe(testHmsMemberId);

      console.log('✅ 월간 구독 결제 성공');
    });

    it('연간 구독 결제를 성공적으로 처리해야 한다', async () => {
      const testMember = membershipData.members[1]; // 이구독 - 연간 구독
      const recurringPaymentRequest = {
        userId: testUserId,
        paymentMethodId: testPaymentMethodId,
        amount: testMember.subscriptionAmount, // 99000원
        currency: 'KRW',
        subscriptionType: 'yearly',
        billingCycle: testMember.billingCycle, // 365일
        discountAmount: 10000, // 할인 적용
        discountMetadata: {
          couponId: 'YEARLY_DISCOUNT',
          discountRate: 10,
        },
      };

      console.log('연간 구독 결제 요청:', recurringPaymentRequest);

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .set('idempotency-key', `test-yearly-${Date.now()}`)
        .send(recurringPaymentRequest)
        .expect(201);

      console.log('연간 구독 결제 응답:', response.body);

      expect(response.body.success).toBe(true);
      expect(response.body.amount).toBe(testMember.subscriptionAmount);

      // 할인 메타데이터 확인
      const [paymentEvent] = await dbService.db
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, response.body.paymentEventId))
        .limit(1);

      const metadata = JSON.parse(paymentEvent.metadata || '{}');
      expect(metadata.subscriptionType).toBe('yearly');
      expect(metadata.discountAmount).toBe(10000);
      expect(metadata.discountMetadata).toEqual({
        couponId: 'YEARLY_DISCOUNT',
        discountRate: 10,
      });

      console.log('✅ 연간 구독 결제 성공 (할인 적용)');
    });

    it('멱등성 키를 사용한 중복 요청은 캐시된 결과를 반환해야 한다', async () => {
      const idempotencyKey = `test-idempotency-${Date.now()}`;
      const recurringPaymentRequest = {
        userId: testUserId,
        paymentMethodId: testPaymentMethodId,
        amount: 9900,
        currency: 'KRW',
        subscriptionType: 'monthly',
        billingCycle: 30,
      };

      // 첫 번째 요청
      const firstResponse = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .set('idempotency-key', idempotencyKey)
        .send(recurringPaymentRequest)
        .expect(201);

      console.log('첫 번째 요청 응답:', firstResponse.body);

      // 동일한 멱등성 키로 두 번째 요청
      const secondResponse = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .set('idempotency-key', idempotencyKey)
        .send(recurringPaymentRequest)
        .expect(201);

      console.log('두 번째 요청 응답:', secondResponse.body);

      // 동일한 결과 반환 확인
      expect(secondResponse.body.transactionId).toBe(
        firstResponse.body.transactionId,
      );
      expect(secondResponse.body.paymentEventId).toBe(
        firstResponse.body.paymentEventId,
      );

      console.log('✅ 멱등성 키 중복 요청 처리 성공');
    });
  });

  describe('4. 결제 상태 조회', () => {
    let testTransactionId: string;

    beforeAll(async () => {
      // 테스트용 결제 실행
      const recurringPaymentRequest = {
        userId: testUserId,
        paymentMethodId: testPaymentMethodId,
        amount: 9900,
        currency: 'KRW',
        subscriptionType: 'monthly',
        billingCycle: 30,
      };

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .set('idempotency-key', `test-status-${Date.now()}`)
        .send(recurringPaymentRequest)
        .expect(201);

      testTransactionId = response.body.transactionId;
    });

    it('결제 트랜잭션 ID로 상태를 조회할 수 있어야 한다', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/payments/recurring/${testTransactionId}`)
        .expect(200);

      console.log('결제 상태 조회 응답:', response.body);

      expect(response.body.transactionId).toBe(testTransactionId);
      expect(response.body.paymentEventId).toBeDefined();
      expect(response.body.status).toMatch(/^(AUTHORIZED|CAPTURED|FAILED)$/);
      expect(response.body.amount).toBe(9900);
      expect(response.body.currency).toBe('KRW');
      expect(response.body.isSubscriptionPayment).toBe(true);
      expect(response.body.subscriptionType).toBe('monthly');
      expect(response.body.paymentPurpose).toBe('SUBSCRIPTION');
      expect(response.body.processedAt).toBeDefined();
    });

    it('존재하지 않는 트랜잭션 ID 조회 시 404 에러를 반환해야 한다', async () => {
      const nonExistentTransactionId = 'non-existent-transaction-id';

      const response = await request(app.getHttpServer())
        .get(`/api/payments/recurring/${nonExistentTransactionId}`)
        .expect(404);

      console.log('존재하지 않는 트랜잭션 조회 응답:', response.body);
      expect(response.body.message).toContain(
        '결제 트랜잭션을 찾을 수 없습니다',
      );
    });
  });

  describe('5. 에러 시나리오 테스트', () => {
    it('존재하지 않는 결제수단으로 결제 시도 시 400 에러를 반환해야 한다', async () => {
      const recurringPaymentRequest = {
        userId: testUserId,
        paymentMethodId: 'non-existent-payment-method',
        amount: 9900,
        currency: 'KRW',
        subscriptionType: 'monthly',
        billingCycle: 30,
      };

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .send(recurringPaymentRequest)
        .expect(400);

      console.log('존재하지 않는 결제수단 에러 응답:', response.body);
      expect(response.body.message).toContain('결제수단을 찾을 수 없습니다');
    });

    it('다른 사용자의 결제수단으로 결제 시도 시 400 에러를 반환해야 한다', async () => {
      const otherUserId = 'other-user-id';
      const recurringPaymentRequest = {
        userId: otherUserId,
        paymentMethodId: testPaymentMethodId,
        amount: 9900,
        currency: 'KRW',
        subscriptionType: 'monthly',
        billingCycle: 30,
      };

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .send(recurringPaymentRequest)
        .expect(400);

      console.log('다른 사용자 결제수단 에러 응답:', response.body);
      expect(response.body.message).toContain('권한이 없습니다');
    });

    it('잘못된 금액으로 결제 시도 시 400 에러를 반환해야 한다', async () => {
      const recurringPaymentRequest = {
        userId: testUserId,
        paymentMethodId: testPaymentMethodId,
        amount: -1000, // 음수 금액
        currency: 'KRW',
        subscriptionType: 'monthly',
        billingCycle: 30,
      };

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .send(recurringPaymentRequest)
        .expect(400);

      console.log('잘못된 금액 에러 응답:', response.body);
      expect(response.body.message).toContain(
        'amount must be a positive number',
      );
    });

    it('비활성화된 결제수단으로 결제 시도 시 400 에러를 반환해야 한다', async () => {
      // 비활성화된 결제수단 생성
      const inactivePaymentMethod = {
        userId: testUserId,
        methodType: 'CARD' as const,
        status: 'INACTIVE' as const,
        paymentPurpose: 'SUBSCRIPTION' as const,
        metadata: JSON.stringify({}),
      };

      const [createdInactiveMethod] = await dbService.db
        .insert(schema.paymentMethod)
        .values(inactivePaymentMethod)
        .returning();

      const recurringPaymentRequest = {
        userId: testUserId,
        paymentMethodId: createdInactiveMethod.id,
        amount: 9900,
        currency: 'KRW',
        subscriptionType: 'monthly',
        billingCycle: 30,
      };

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .send(recurringPaymentRequest)
        .expect(400);

      console.log('비활성화된 결제수단 에러 응답:', response.body);
      expect(response.body.message).toContain('비활성화된 결제수단입니다');

      // 테스트 데이터 정리
      await dbService.db
        .delete(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, createdInactiveMethod.id));
    });
  });

  describe('6. 동시성 및 성능 테스트', () => {
    it('동시에 여러 결제 요청이 들어와도 정상 처리되어야 한다', async () => {
      const concurrentRequests = Array.from({ length: 5 }, (_, index) => {
        const recurringPaymentRequest = {
          userId: testUserId,
          paymentMethodId: testPaymentMethodId,
          amount: 1000 + index * 100, // 각기 다른 금액
          currency: 'KRW',
          subscriptionType: 'monthly',
          billingCycle: 30,
        };

        return request(app.getHttpServer())
          .post('/api/payments/recurring')
          .set('idempotency-key', `concurrent-test-${index}-${Date.now()}`)
          .send(recurringPaymentRequest);
      });

      const responses = await Promise.all(concurrentRequests);

      console.log(
        '동시 요청 결과:',
        responses.map((r) => ({
          status: r.status,
          success: r.body.success,
          amount: r.body.amount,
          transactionId: r.body.transactionId?.substring(0, 10) + '...',
        })),
      );

      // 모든 요청이 성공해야 함
      responses.forEach((response, index) => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.amount).toBe(1000 + index * 100);
      });

      // 모든 트랜잭션 ID가 고유해야 함
      const transactionIds = responses.map((r) => r.body.transactionId);
      const uniqueTransactionIds = new Set(transactionIds);
      expect(uniqueTransactionIds.size).toBe(transactionIds.length);

      console.log('✅ 동시성 테스트 성공');
    });
  });

  // 테스트 데이터 설정
  async function setupTestData() {
    // 테스트용 사용자 ID 생성
    testUserId = `test-user-${Date.now()}`;

    console.log(`테스트 사용자 ID: ${testUserId}`);
    console.log('테스트 데이터 설정 완료');
  }

  // 테스트 데이터 정리
  async function cleanupTestData() {
    try {
      if (testPaymentMethodId) {
        // CardMethod 삭제
        await dbService.db
          .delete(schema.cardMethod)
          .where(eq(schema.cardMethod.id, testPaymentMethodId));

        // PaymentMethod 삭제
        await dbService.db
          .delete(schema.paymentMethod)
          .where(eq(schema.paymentMethod.id, testPaymentMethodId));
      }

      // 테스트 사용자의 PaymentEvents 삭제
      await dbService.db
        .delete(schema.paymentEvents)
        .where(eq(schema.paymentEvents.paymentMethodId, testPaymentMethodId));

      console.log('테스트 데이터 정리 완료');
    } catch (error) {
      console.warn('테스트 데이터 정리 중 오류:', error.message);
    }
  }
});
