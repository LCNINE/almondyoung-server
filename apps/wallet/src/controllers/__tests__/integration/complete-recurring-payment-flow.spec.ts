import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as request from 'supertest';
import { DbService, DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import * as schema from '../../../shared/database/schema';
import { eq, and } from 'drizzle-orm';

// Controllers
import { RecurringPaymentController } from '../../recurring-payment.controller';
import { PaymentMethodController } from '../../payment-method.controller';

// Services
import { RecurringPaymentService } from '../../../services/recurring-payment.service';
import { RecurringPaymentLoggerService } from '../../../services/recurring-payment-logger.service';
import { PaymentService } from '../../../services/payment.service';
import { PaymentMethodService } from '../../../services/payment-method.service';
import { PaymentStrategyFactory } from '../../../factories/payment-strategy.factory';

// Strategies
import { CardStrategy } from '../../../strategies/card.strategy';

// Adapters
import { HmsCardPaymentAdapter } from '../../../adapters/hms-card-payment.adapter';

// Tokens
import { HMS_CARD_PAYMENT_ADAPTER } from '../../../shared/tokens/gateway.tokens';

// Filters
// import { RecurringPaymentExceptionFilter } from '../../../shared/filters/recurring-payment-exception.filter';

// Test data
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 완전한 정기결제 플로우 통합 테스트
 *
 * 이 테스트는 다음 전체 플로우를 검증합니다:
 * 1. HMS 카드 등록 및 memberID 획득
 * 2. 정기결제수단 등록 (paymentPurpose: SUBSCRIPTION)
 * 3. 결제수단 검증
 * 4. 구독 정기결제 실행
 * 5. PaymentEvents 테이블에 기록 확인
 * 6. 결제 상태 조회
 *
 * 모든 단계에서 실제 DB에 데이터가 저장되는지 확인합니다.
 */
describe('Complete Recurring Payment Flow Integration Test', () => {
  let app: INestApplication;
  let dbService: DbService<typeof schema>;
  let recurringPaymentService: RecurringPaymentService;
  let paymentMethodService: PaymentMethodService;
  let hmsCardAdapter: HmsCardPaymentAdapter;

  // 테스트 데이터
  let membershipData: any;
  let testUserId: string;
  let testHmsMemberId: string;
  let testPaymentMethodId: string;
  let testTransactionId: string;
  let testPaymentEventId: string;

  beforeAll(async () => {
    console.log('🚀 완전한 정기결제 플로우 통합 테스트 시작');

    // 멤버십 테스트 데이터 로드
    const membershipDbPath = join(
      __dirname,
      '../../../test/membership-db.json',
    );
    membershipData = JSON.parse(readFileSync(membershipDbPath, 'utf-8'));

    console.log('📊 테스트 데이터 로드:', {
      members: membershipData.members.length,
      paymentMethods: membershipData.paymentMethods.length,
      plans: membershipData.subscriptionPlans.length,
    });

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
      controllers: [RecurringPaymentController, PaymentMethodController],
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
    // app.useGlobalFilters(new RecurringPaymentExceptionFilter());

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

    // 테스트용 사용자 ID 생성
    testUserId = `test-user-${Date.now()}`;
    console.log(`👤 테스트 사용자 ID: ${testUserId}`);
  });

  afterAll(async () => {
    // 테스트 데이터 정리
    await cleanupTestData();
    await app.close();
    console.log('🏁 테스트 완료 및 정리');
  });

  describe('1단계: HMS 카드 등록 및 memberID 획득', () => {
    it('신용카드를 HMS에 등록하고 memberID를 획득해야 한다', async () => {
      const testCard = membershipData.paymentMethods[0];
      const cardInfo = testCard.cardInfo;

      console.log('\n🔄 1단계: HMS 카드 등록 시작');
      console.log('카드 정보:', {
        memberName: cardInfo.memberName,
        phone: cardInfo.phone,
        maskedCardNumber: cardInfo.maskedCardNumber,
      });

      // HMS 카드 등록 요청
      const registrationRequest = {
        userId: testUserId,
        memberName: cardInfo.memberName,
        phone: cardInfo.phone,
        paymentNumber: cardInfo.paymentNumber,
        payerName: cardInfo.payerName,
        payerNumber: cardInfo.payerNumber,
        validYear: cardInfo.validYear,
        validMonth: cardInfo.validMonth,
      };

      const registrationResult =
        await hmsCardAdapter.registerRecurringMember(registrationRequest);

      console.log('HMS 등록 결과:', {
        success: registrationResult.success,
        hmsMemberId: registrationResult.hmsMemberId,
        error: registrationResult.error,
      });

      // 검증
      expect(registrationResult.success).toBe(true);
      expect(registrationResult.hmsMemberId).toBeDefined();
      expect(registrationResult.hmsMemberId).toMatch(/^HMS_/);

      // 테스트용 HMS memberID 저장
      testHmsMemberId = registrationResult.hmsMemberId!;

      console.log(`✅ 1단계 완료: HMS memberID 획득 - ${testHmsMemberId}`);
    });
  });

  describe('2단계: 정기결제수단 등록 (DB 저장)', () => {
    it('획득한 HMS memberID로 정기결제수단을 DB에 등록해야 한다', async () => {
      console.log('\n🔄 2단계: 정기결제수단 DB 등록 시작');

      const testCard = membershipData.paymentMethods[0];

      // PaymentMethod 테이블에 등록
      const paymentMethodData = {
        userId: testUserId,
        methodType: 'CARD' as const,
        methodName: 'Test Card',
        status: 'ACTIVE' as const,
        paymentPurpose: 'SUBSCRIPTION' as const, // 중요: 구독 전용
        metadata: JSON.stringify({
          registeredAt: new Date().toISOString(),
          source: 'integration-test',
        }),
      };

      const [createdPaymentMethod] = await dbService.db
        .insert(schema.paymentMethod)
        .values(paymentMethodData)
        .returning();

      testPaymentMethodId = createdPaymentMethod.id;

      console.log('PaymentMethod 등록 완료:', {
        id: testPaymentMethodId,
        userId: createdPaymentMethod.userId,
        methodType: createdPaymentMethod.methodType,
        paymentPurpose: createdPaymentMethod.paymentPurpose,
      });

      // CardMethod 테이블에 HMS 정보 등록
      const cardMethodData = {
        id: testPaymentMethodId,
        hmsMemberId: testHmsMemberId,
        pgToken: `test_token_${Date.now()}`,
        billingKey: `test_billing_${Date.now()}`,
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

      console.log('CardMethod 등록 완료:', {
        id: testPaymentMethodId,
        hmsMemberId: testHmsMemberId,
        maskedCardNumber: cardMethodData.maskedCardNumber,
      });

      // DB에서 등록 확인
      const savedPaymentMethod = await dbService.db
        .select()
        .from(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, testPaymentMethodId))
        .limit(1);

      const savedCardMethod = await dbService.db
        .select()
        .from(schema.cardMethod)
        .where(eq(schema.cardMethod.id, testPaymentMethodId))
        .limit(1);

      // 검증
      expect(savedPaymentMethod).toHaveLength(1);
      expect(savedCardMethod).toHaveLength(1);
      expect(savedPaymentMethod[0].userId).toBe(testUserId);
      expect(savedPaymentMethod[0].paymentPurpose).toBe('SUBSCRIPTION');
      expect(savedCardMethod[0].hmsMemberId).toBe(testHmsMemberId);

      console.log('✅ 2단계 완료: 정기결제수단 DB 등록 성공');
    });
  });

  describe('3단계: 결제수단 검증', () => {
    it('등록된 결제수단이 구독 결제에 유효한지 검증해야 한다', async () => {
      console.log('\n🔄 3단계: 결제수단 검증 시작');

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring/validate-payment-method')
        .send({
          paymentMethodId: testPaymentMethodId,
          userId: testUserId,
          expectedAmount: 9900,
          performDetailedValidation: true,
        })
        .expect(200);

      console.log('검증 응답:', response.body);

      // 검증
      expect(response.body.isValid).toBe(true);
      expect(response.body.paymentMethodId).toBe(testPaymentMethodId);
      expect(response.body.methodType).toBe('CARD');
      expect(response.body.paymentPurpose).toBe('SUBSCRIPTION');
      expect(response.body.hmsMemberId).toBe(testHmsMemberId);
      expect(response.body.validationDetails).toBeDefined();

      console.log('✅ 3단계 완료: 결제수단 검증 성공');
    });

    it('PURCHASE 전용 결제수단은 구독 결제에 사용할 수 없어야 한다', async () => {
      console.log('\n🔄 PURCHASE 전용 결제수단 검증 테스트');

      // PURCHASE 전용 결제수단 생성
      const purchaseOnlyData = {
        userId: testUserId,
        methodType: 'CARD' as const,
        methodName: 'Purchase Only Card',
        status: 'ACTIVE' as const,
        paymentPurpose: 'PURCHASE' as const,
        metadata: JSON.stringify({ test: true }),
      };

      const [purchaseMethod] = await dbService.db
        .insert(schema.paymentMethod)
        .values(purchaseOnlyData)
        .returning();

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring/validate-payment-method')
        .send({
          paymentMethodId: purchaseMethod.id,
          userId: testUserId,
          performDetailedValidation: false,
        })
        .expect(200);

      // 검증 실패 확인
      expect(response.body.isValid).toBe(false);
      expect(response.body.error).toContain('구독 결제가 허용되지 않은');
      expect(response.body.paymentPurpose).toBe('PURCHASE');

      // 테스트 데이터 정리
      await dbService.db
        .delete(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, purchaseMethod.id));

      console.log('✅ PURCHASE 전용 결제수단 거부 확인');
    });
  });

  describe('4단계: 구독 정기결제 실행', () => {
    it('월간 구독 결제를 실행하고 DB에 기록해야 한다', async () => {
      console.log('\n🔄 4단계: 구독 정기결제 실행 시작');

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

      // 응답 검증
      expect(response.body.success).toBe(true);
      expect(response.body.transactionId).toBeDefined();
      expect(response.body.paymentEventId).toBeDefined();
      expect(response.body.status).toMatch(/^(AUTHORIZED|CAPTURED)$/);
      expect(response.body.amount).toBe(testMember.subscriptionAmount);
      expect(response.body.processedAt).toBeDefined();
      expect(response.body.gatewayResponse).toBeDefined();

      // 테스트용 ID 저장
      testTransactionId = response.body.transactionId;
      testPaymentEventId = response.body.paymentEventId;

      console.log('결제 완료:', {
        transactionId: testTransactionId,
        paymentEventId: testPaymentEventId,
        status: response.body.status,
      });

      console.log('✅ 4단계 완료: 구독 정기결제 실행 성공');
    });

    it('PaymentEvents 테이블에 구독 결제 정보가 올바르게 기록되어야 한다', async () => {
      console.log('\n🔄 PaymentEvents 테이블 기록 확인');

      // PaymentEvents 테이블에서 기록 조회
      const [paymentEvent] = await dbService.db
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, testPaymentEventId))
        .limit(1);

      console.log('PaymentEvent 기록:', {
        id: paymentEvent.id,
        paymentMethodId: paymentEvent.paymentMethodId,
        amount: paymentEvent.amount,
        status: paymentEvent.status,
        pgTransactionId: paymentEvent.pgTransactionId,
        actor: paymentEvent.actor,
        createdAt: paymentEvent.createdAt,
      });

      // 기본 정보 검증
      expect(paymentEvent).toBeDefined();
      expect(paymentEvent.paymentMethodId).toBe(testPaymentMethodId);
      expect(paymentEvent.amount).toBe(9900);
      expect(paymentEvent.status).toMatch(/^(AUTHORIZED|CAPTURED)$/);
      expect(paymentEvent.pgTransactionId).toBe(testTransactionId);
      expect(paymentEvent.actor).toBe('SYSTEM');

      // 메타데이터 검증
      const metadata = JSON.parse(paymentEvent.metadata || '{}');
      console.log('PaymentEvent 메타데이터:', metadata);

      expect(metadata.isSubscriptionPayment).toBe(true);
      expect(metadata.subscriptionType).toBe('monthly');
      expect(metadata.paymentPurpose).toBe('SUBSCRIPTION');
      expect(metadata.hmsMemberId).toBe(testHmsMemberId);
      expect(metadata.originalAmount).toBe(9900);
      expect(metadata.gatewayType).toBeDefined();

      console.log('✅ PaymentEvents 테이블 기록 확인 완료');
    });
  });

  describe('5단계: 결제 상태 조회', () => {
    it('트랜잭션 ID로 결제 상태를 조회할 수 있어야 한다', async () => {
      console.log('\n🔄 5단계: 결제 상태 조회 시작');

      const response = await request(app.getHttpServer())
        .get(`/api/payments/recurring/${testTransactionId}`)
        .expect(200);

      console.log('결제 상태 조회 응답:', response.body);

      // 응답 검증
      expect(response.body.transactionId).toBe(testTransactionId);
      expect(response.body.paymentEventId).toBe(testPaymentEventId);
      expect(response.body.status).toMatch(/^(AUTHORIZED|CAPTURED|FAILED)$/);
      expect(response.body.amount).toBe(9900);
      expect(response.body.currency).toBe('KRW');
      expect(response.body.isSubscriptionPayment).toBe(true);
      expect(response.body.subscriptionType).toBe('monthly');
      expect(response.body.paymentPurpose).toBe('SUBSCRIPTION');
      expect(response.body.processedAt).toBeDefined();

      console.log('✅ 5단계 완료: 결제 상태 조회 성공');
    });
  });

  describe('6단계: 전체 플로우 검증', () => {
    it('전체 데이터베이스 상태가 일관성 있게 유지되어야 한다', async () => {
      console.log('\n🔄 6단계: 전체 DB 상태 일관성 검증');

      // 1. PaymentMethod 테이블 확인
      const [paymentMethod] = await dbService.db
        .select()
        .from(schema.paymentMethod)
        .where(
          and(
            eq(schema.paymentMethod.id, testPaymentMethodId),
            eq(schema.paymentMethod.userId, testUserId),
          ),
        )
        .limit(1);

      expect(paymentMethod).toBeDefined();
      expect(paymentMethod.paymentPurpose).toBe('SUBSCRIPTION');
      expect(paymentMethod.status).toBe('ACTIVE');

      // 2. CardMethod 테이블 확인
      const [cardMethod] = await dbService.db
        .select()
        .from(schema.cardMethod)
        .where(eq(schema.cardMethod.id, testPaymentMethodId))
        .limit(1);

      expect(cardMethod).toBeDefined();
      expect(cardMethod.hmsMemberId).toBe(testHmsMemberId);

      // 3. PaymentEvents 테이블 확인
      const [paymentEvent] = await dbService.db
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.paymentMethodId, testPaymentMethodId))
        .limit(1);

      expect(paymentEvent).toBeDefined();
      expect(paymentEvent.pgTransactionId).toBe(testTransactionId);

      // 4. 데이터 일관성 검증
      expect(paymentEvent.paymentMethodId).toBe(paymentMethod.id);
      expect(cardMethod.id).toBe(paymentMethod.id);

      const metadata = JSON.parse(paymentEvent.metadata || '{}');
      expect(metadata.hmsMemberId).toBe(cardMethod.hmsMemberId);
      expect(metadata.paymentPurpose).toBe(paymentMethod.paymentPurpose);

      console.log('DB 일관성 검증 완료:', {
        paymentMethodId: paymentMethod.id,
        hmsMemberId: cardMethod.hmsMemberId,
        transactionId: paymentEvent.pgTransactionId,
        paymentPurpose: paymentMethod.paymentPurpose,
        subscriptionPayment: metadata.isSubscriptionPayment,
      });

      console.log('✅ 6단계 완료: 전체 DB 상태 일관성 확인');
    });

    it('연간 구독 결제도 정상 처리되어야 한다', async () => {
      console.log('\n🔄 연간 구독 결제 추가 테스트');

      const yearlyRequest = {
        userId: testUserId,
        paymentMethodId: testPaymentMethodId,
        amount: 99000, // 연간 구독료
        currency: 'KRW',
        subscriptionType: 'yearly',
        billingCycle: 365,
        discountAmount: 10000,
        discountMetadata: {
          couponId: 'YEARLY_DISCOUNT',
          discountRate: 10,
        },
      };

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .set('idempotency-key', `test-yearly-${Date.now()}`)
        .send(yearlyRequest)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.amount).toBe(99000);

      // PaymentEvents에서 할인 메타데이터 확인
      const [yearlyEvent] = await dbService.db
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, response.body.paymentEventId))
        .limit(1);

      const yearlyMetadata = JSON.parse(yearlyEvent.metadata || '{}');
      expect(yearlyMetadata.subscriptionType).toBe('yearly');
      expect(yearlyMetadata.discountAmount).toBe(10000);
      expect(yearlyMetadata.discountMetadata.couponId).toBe('YEARLY_DISCOUNT');

      console.log('✅ 연간 구독 결제 테스트 완료');
    });
  });

  describe('7단계: 에러 시나리오 테스트', () => {
    it('존재하지 않는 결제수단으로 결제 시도 시 실패해야 한다', async () => {
      console.log('\n🔄 에러 시나리오: 존재하지 않는 결제수단');

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .send({
          userId: testUserId,
          paymentMethodId: 'non-existent-payment-method',
          amount: 9900,
          currency: 'KRW',
          subscriptionType: 'monthly',
          billingCycle: 30,
        })
        .expect(400);

      expect(response.body.message).toContain('결제수단을 찾을 수 없습니다');
      console.log('✅ 존재하지 않는 결제수단 에러 처리 확인');
    });

    it('다른 사용자의 결제수단으로 결제 시도 시 실패해야 한다', async () => {
      console.log('\n🔄 에러 시나리오: 다른 사용자의 결제수단');

      const response = await request(app.getHttpServer())
        .post('/api/payments/recurring')
        .send({
          userId: 'other-user-id',
          paymentMethodId: testPaymentMethodId,
          amount: 9900,
          currency: 'KRW',
          subscriptionType: 'monthly',
          billingCycle: 30,
        })
        .expect(400);

      expect(response.body.message).toContain('권한이 없습니다');
      console.log('✅ 다른 사용자 결제수단 에러 처리 확인');
    });
  });

  // 테스트 데이터 정리 함수
  async function cleanupTestData() {
    try {
      console.log('\n🧹 테스트 데이터 정리 시작');

      if (testPaymentMethodId) {
        // PaymentEvents 삭제
        await dbService.db
          .delete(schema.paymentEvents)
          .where(eq(schema.paymentEvents.paymentMethodId, testPaymentMethodId));

        // CardMethod 삭제
        await dbService.db
          .delete(schema.cardMethod)
          .where(eq(schema.cardMethod.id, testPaymentMethodId));

        // PaymentMethod 삭제
        await dbService.db
          .delete(schema.paymentMethod)
          .where(eq(schema.paymentMethod.id, testPaymentMethodId));
      }

      // 테스트 사용자의 모든 데이터 정리
      await dbService.db
        .delete(schema.paymentMethod)
        .where(eq(schema.paymentMethod.userId, testUserId));

      console.log('✅ 테스트 데이터 정리 완료');
    } catch (error) {
      console.warn('⚠️ 테스트 데이터 정리 중 오류:', error.message);
    }
  }
});
