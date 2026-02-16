import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DbModule, DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { generateUUIDv7 } from '../../shared/utils/id-generator';

// Services
import { PaymentService } from '../payment.service';
import { IntentService } from '../intents/intent.service';
import { PointService } from '../points/point.service';
import { RefundService } from '../refund.service';
import { ProviderType } from '../../providers/payment-provider.interface';

// Implementation Layer
import { PaymentReader } from '../payment/payment.reader';
import { PaymentManager } from '../payment/payment.manager';
import { PaymentPointManager } from '../payment/payment-point.manager';
import { PaymentProviderManager } from '../payment/payment-provider.manager';
import { IntentReader } from '../intents/intent.reader';
import { IntentCreator } from '../intents/intent.creator';
import { IntentManager } from '../intents/intent.manager';
import { PointReader } from '../points/point.reader';
import { PointManager } from '../points/point.manager';

// Repositories
import { IntentRepository } from '../intents/intent.repository';
import { PaymentAttemptRepository } from '../payment/payment-attempt.repository';
import { PointRepository } from '../points/point.repository';

// Utilities
import { PaymentRequestBuilder } from '../payment/payment-request.builder';

// Providers
import { ProviderRegistry } from '../../providers/provider-registry';
import { TossChargeProvider } from '../../providers/toss.charge';
import { PaymentProfileService } from '../profiles/payment-profile.service';
import {
  PaymentProfilesRepository,
  CmsCardProfilesRepository,
  CmsBatchProfilesRepository,
} from '../profiles/payment-profile.repository';

// BNPL
import { BnplService } from '../bnpl/bnpl.service';
import { BnplSettlementService } from '../bnpl/bnpl-settlement.service';
import { BnplAccountReader } from '../bnpl/bnpl-account.reader';
import { BnplAccountCreator } from '../bnpl/bnpl-account.creator';
import { BnplCreditManager } from '../bnpl/bnpl-credit.manager';
import { BnplBatchCreator } from '../bnpl/bnpl-batch.creator';
import { BnplCmsManager } from '../bnpl/bnpl-cms.manager';
import { BnplRetryManager } from '../bnpl/bnpl-retry.manager';
import { BnplRepository } from '../bnpl/bnpl.repository';

// Other Services
import { TaxInvoiceService } from '../tax-invoice.service';
import { IdempotencyService } from '../idempotency.service';

// Providers
import { HmsCardRegistrar } from '../../providers/hms-card.registrar';
import { HmsBnplRegistrar } from '../../providers/hms-bnpl.registrar';
import { HmsCardChargeProvider } from '../../providers/hms-card.charge';
import { HmsBnplChargeProvider } from '../../providers/hms-bnpl.charge';
import { HmsBnplCashReceiptProvider } from '../../providers/hms-bnpl.cash-receipt';
import { HmsBnplTaxInvoiceProvider } from '../../providers/hms-bnpl.tax-invoice';
import { HmsCardRefundProvider } from '../../providers/hms-card.refund';
import { TossRefundProvider } from '../../providers/toss.refund';

/**
 * Payment 통합 테스트
 *
 * 테스트 시나리오:
 * 1. Intent 생성 → 포인트 혼합 결제 → Authorize → Capture
 * 2. 포인트 전액 결제
 * 3. 환불 처리
 * 4. 멱등성 검증
 */
describe('PaymentService (Integration)', () => {
  let module: TestingModule;
  let paymentService: PaymentService;
  let intentService: IntentService;
  let pointService: PointService;
  let refundService: RefundService;
  let dbService: DbService<typeof walletSchema>;
  let providerRegistry: ProviderRegistry;

  // 테스트 데이터
  let testCustomerId: string; // UUIDv7
  let testPartnerId: string; // UUIDv7 (customerId와 동일)

  beforeAll(async () => {
    // Provider Registry 목업 생성
    const mockProviderRegistry = {
      get: jest.fn().mockReturnValue({
        charge: {
          process: jest.fn().mockResolvedValue({
            success: true,
            transactionId: `toss-tx-${Date.now()}`,
            code: 'SUCCESS',
            message: 'Payment authorized successfully',
          }),
          capture: jest.fn().mockResolvedValue({
            success: true,
            transactionId: `toss-capture-${Date.now()}`,
            code: 'SUCCESS',
            message: 'Payment captured successfully',
          }),
        },
      }),
    };

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.DATABASE_URL ||
              'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: { ...walletSchema },
        }),
      ],
      providers: [
        // AppModule의 providers 그대로 복사
        PaymentService,
        IntentService,
        PaymentProfileService,
        TaxInvoiceService,
        BnplService,
        BnplSettlementService,
        RefundService,

        // --- Point 도메인 ---
        PointService,
        PointReader,
        PointManager,
        PointRepository,

        IdempotencyService,

        // --- Intent Implementation Layer ---
        IntentReader,
        IntentCreator,
        IntentManager,
        IntentRepository,

        // --- Payment Implementation Layer ---
        PaymentReader,
        PaymentManager,
        PaymentPointManager,
        PaymentProviderManager,
        PaymentAttemptRepository,
        PaymentRequestBuilder,

        // --- BNPL Implementation Layer ---
        BnplAccountReader,
        BnplAccountCreator,
        BnplCreditManager,
        BnplBatchCreator,
        BnplCmsManager,
        BnplRetryManager,
        BnplRepository,

        // --- 데이터 접근 ---
        PaymentProfilesRepository,
        CmsCardProfilesRepository,
        CmsBatchProfilesRepository,

        // --- Provider 아키텍처 ---
        // ProviderRegistry만 사용하고 개별 Provider는 목업으로 처리
        ProviderRegistry,
        TossChargeProvider,
      ],
    })
      .overrideProvider(ProviderRegistry)
      .useValue(mockProviderRegistry)
      .compile();

    paymentService = module.get<PaymentService>(PaymentService);
    intentService = module.get<IntentService>(IntentService);
    pointService = module.get<PointService>(PointService);
    refundService = module.get<RefundService>(RefundService);
    dbService = module.get<DbService<typeof walletSchema>>(DbService);
    providerRegistry = module.get<ProviderRegistry>(ProviderRegistry);
  });

  beforeEach(async () => {
    if (dbService) {
      await cleanupDatabase();
      await setupTestData();
    }
  });

  afterEach(async () => {
    if (dbService) {
      await cleanupDatabase();
    }
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('전체 플로우: Intent 생성 → 혼합 결제 → Capture → 환불', () => {
    it('1. Intent를 생성할 수 있어야 한다', async () => {
      const intent = await intentService.createIntent({
        customerId: testCustomerId,
        amount: 50000,
        type: 'ORDER',
        expiresInMinutes: 30,
      });

      expect(intent).toBeDefined();
      expect(intent.id).toBeDefined();
      expect(intent.customerId).toBe(testCustomerId);
      expect(intent.amount).toBe(50000);
      expect(intent.status).toBe('PENDING');

      // DB 확인
      const dbIntent = await dbService.db.query.paymentIntents.findFirst({
        where: eq(schema.paymentIntents.id, intent.id),
      });

      expect(dbIntent).toBeDefined();
      expect(dbIntent?.status).toBe('PENDING');
    });

    it('2. 포인트 혼합 결제(10,000원 포인트 + 40,000원 카드)를 할 수 있어야 한다', async () => {
      // Intent 생성
      const intent = await intentService.createIntent({
        customerId: testCustomerId,
        amount: 50000,
        type: 'ORDER',
      });

      // 결제 승인 (포인트 10,000원 사용)
      const result = await paymentService.authorizePaymentByIntent(
        intent.id,
        ProviderType.TOSS,
        {
          usePoints: 10000,
          instrumentRef: 'test-payment-key-123',
          instrumentType: 'ONE_TIME',
        },
      );

      expect(result.success).toBe(true);
      expect(result.attemptId).toBeDefined();
      expect(result.pointEventId).toBeDefined();
      expect(result.breakdown).toEqual({
        totalAmount: 50000,
        pointsUsed: 10000,
        finalAmount: 40000,
      });

      // Intent 상태 확인
      const updatedIntent = await intentService.findById(intent.id);
      expect(updatedIntent?.status).toBe('AUTHORIZED');
      expect(updatedIntent?.discountsTotal).toBe(10000);
      expect(updatedIntent?.finalAmount).toBe(40000);

      // 포인트 차감 확인
      const balance = await pointService.getBalance(testPartnerId);
      expect(balance).toBe(40000); // 50,000 - 10,000

      // Attempt 확인
      const attempt = await dbService.db.query.paymentAttempts.findFirst({
        where: eq(schema.paymentAttempts.id, result.attemptId!),
      });

      expect(attempt).toBeDefined();
      expect(attempt?.status).toBe('AUTHORIZED');
      expect(attempt?.provider).toBe('TOSS');
      expect(attempt?.amount).toBe(40000);
    });

    it('3. 승인된 결제를 캡처할 수 있어야 한다', async () => {
      // Intent 생성 및 승인
      const intent = await intentService.createIntent({
        customerId: testCustomerId,
        amount: 50000,
        type: 'ORDER',
      });

      const authResult = await paymentService.authorizePaymentByIntent(
        intent.id,
        ProviderType.TOSS,
        {
          usePoints: 10000,
          instrumentRef: 'test-payment-key-456',
          instrumentType: 'ONE_TIME',
        },
      );

      // 캡처
      const captureResult = await paymentService.capturePaymentByIntent(
        intent.id,
        authResult.attemptId!,
      );

      expect(captureResult.success).toBe(true);

      // Intent 상태 확인
      const capturedIntent = await intentService.findById(intent.id);
      expect(capturedIntent?.status).toBe('CAPTURED');

      // Attempt 상태 확인
      const attempt = await dbService.db.query.paymentAttempts.findFirst({
        where: eq(schema.paymentAttempts.id, authResult.attemptId!),
      });

      expect(attempt?.status).toBe('CAPTURED');
    });

    it('4. 결제를 환불할 수 있어야 한다', async () => {
      // Intent 생성, 승인, 캡처
      const intent = await intentService.createIntent({
        customerId: testCustomerId,
        amount: 50000,
        type: 'ORDER',
      });

      const authResult = await paymentService.authorizePaymentByIntent(
        intent.id,
        ProviderType.TOSS,
        {
          usePoints: 10000,
          instrumentRef: 'test-payment-key-789',
          instrumentType: 'ONE_TIME',
        },
      );

      await paymentService.capturePaymentByIntent(
        intent.id,
        authResult.attemptId!,
      );

      // 환불 전 포인트 잔액
      const balanceBefore = await pointService.getBalance(testPartnerId);
      expect(balanceBefore).toBe(40000); // 50,000 - 10,000

      // 환불 (전액)
      const refundResult = await refundService.refundPayment(
        intent.id,
        undefined, // 전액 환불
        'CUSTOMER_REQUEST',
      );

      expect(refundResult.success).toBe(true);
      expect(refundResult.refunded.total).toBe(50000);
      expect(refundResult.refunded.points).toBe(10000);

      // 환불 후 포인트 복원 확인
      const balanceAfter = await pointService.getBalance(testPartnerId);
      expect(balanceAfter).toBe(50000); // 40,000 + 10,000 복원

      // Intent 상태 확인
      const refundedIntent = await intentService.findById(intent.id);
      expect(refundedIntent?.status).toBe('REFUNDED');
    });
  });

  describe('포인트 전액 결제', () => {
    it('포인트만으로 전액 결제할 수 있어야 한다', async () => {
      // Intent 생성 (30,000원)
      const intent = await intentService.createIntent({
        customerId: testCustomerId,
        amount: 30000,
        type: 'ORDER',
      });

      // 포인트 전액 결제 (Provider 없음)
      const result = await paymentService.authorizePaymentByIntent(
        intent.id,
        null, // Provider 없음
        {
          usePoints: 30000,
        },
      );

      expect(result.success).toBe(true);
      expect(result.attemptId).toBeNull(); // 포인트 전액은 Attempt 없음
      expect(result.pointEventId).toBeDefined();
      expect(result.breakdown).toEqual({
        totalAmount: 30000,
        pointsUsed: 30000,
        finalAmount: 0,
      });

      // Intent가 바로 CAPTURED 상태여야 함
      const capturedIntent = await intentService.findById(intent.id);
      expect(capturedIntent?.status).toBe('CAPTURED');

      // 포인트 차감 확인
      const balance = await pointService.getBalance(testPartnerId);
      expect(balance).toBe(20000); // 50,000 - 30,000
    });
  });

  describe('부분 환불', () => {
    it('결제 금액의 일부만 환불할 수 있어야 한다', async () => {
      // Intent 생성, 승인, 캡처
      const intent = await intentService.createIntent({
        customerId: testCustomerId,
        amount: 50000,
        type: 'ORDER',
      });

      const authResult = await paymentService.authorizePaymentByIntent(
        intent.id,
        ProviderType.TOSS,
        {
          usePoints: 10000,
          instrumentRef: 'test-payment-key-partial',
          instrumentType: 'ONE_TIME',
        },
      );

      await paymentService.capturePaymentByIntent(
        intent.id,
        authResult.attemptId!,
      );

      // 부분 환불 (20,000원만)
      const refundResult = await refundService.refundPayment(
        intent.id,
        20000,
        'PARTIAL_CANCEL',
      );

      expect(refundResult.success).toBe(true);
      expect(refundResult.refunded.total).toBe(20000);

      // 포인트 비율 계산: 20,000 / 50,000 = 40%
      // 포인트 환불: floor(10,000 * 0.4) = 4,000
      expect(refundResult.refunded.points).toBe(4000);

      // 포인트 복원 확인
      const balance = await pointService.getBalance(testPartnerId);
      expect(balance).toBe(44000); // 40,000 + 4,000
    });
  });

  describe('엣지 케이스', () => {
    it('포인트 잔액이 부족하면 에러를 던져야 한다', async () => {
      const intent = await intentService.createIntent({
        customerId: testCustomerId,
        amount: 100000, // 잔액(50,000)보다 많음
        type: 'ORDER',
      });

      await expect(
        paymentService.authorizePaymentByIntent(intent.id, ProviderType.TOSS, {
          usePoints: 60000, // 잔액 초과
          instrumentRef: 'test-key',
          instrumentType: 'ONE_TIME',
        }),
      ).rejects.toThrow('Insufficient points');
    });

    it('만료된 Intent는 결제할 수 없어야 한다', async () => {
      // 이미 만료된 Intent 생성
      const expiredIntent = await dbService.db
        .insert(schema.paymentIntents)
        .values({
          id: 'expired-intent-001',
          customerId: testCustomerId,
          amount: 10000,
          totalAmount: 10000,
          finalAmount: 10000,
          type: 'ORDER',
          status: 'PENDING',
          expiresAt: new Date(Date.now() - 1000), // 1초 전 만료
        })
        .returning();

      await expect(
        paymentService.authorizePaymentByIntent(
          expiredIntent[0].id,
          ProviderType.TOSS,
          {
            instrumentRef: 'test-key',
            instrumentType: 'ONE_TIME',
          },
        ),
      ).rejects.toThrow('Intent expired');
    });

    it('이미 AUTHORIZED 상태인 Intent는 다시 승인할 수 없어야 한다', async () => {
      const intent = await intentService.createIntent({
        customerId: testCustomerId,
        amount: 10000,
        type: 'ORDER',
      });

      // 첫 번째 승인
      await paymentService.authorizePaymentByIntent(
        intent.id,
        ProviderType.TOSS,
        {
          instrumentRef: 'test-key-1',
          instrumentType: 'ONE_TIME',
        },
      );

      // 두 번째 승인 시도
      await expect(
        paymentService.authorizePaymentByIntent(intent.id, ProviderType.TOSS, {
          instrumentRef: 'test-key-2',
          instrumentType: 'ONE_TIME',
        }),
      ).rejects.toThrow('Intent not in valid state');
    });
  });

  // 🧹 청소 함수
  async function cleanupDatabase() {
    try {
      // FK 제약 순서대로 삭제 (자식 → 부모)
      await dbService.db.delete(schema.paymentRefunds);
      await dbService.db.delete(schema.paymentAttempts);
      await dbService.db.delete(schema.paymentIntents);
      await dbService.db.delete(schema.pointEventDetails);
      await dbService.db.delete(schema.pointEvents);
    } catch (error) {
      console.warn('청소 중 에러 발생:', error);
    }
  }

  // 테스트 데이터 생성
  async function setupTestData() {
    // UUIDv7 생성 (customerId와 partnerId 동일)
    testCustomerId = generateUUIDv7();
    testPartnerId = testCustomerId;

    // 포인트 적립 (50,000원)
    await pointService.addPoints({
      partnerId: testPartnerId,
      amount: 50000,
      reason: 'TEST_SETUP',
      memo: 'Initial balance for testing',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1년 후
      withdrawalAvailableAt: new Date(), // 즉시 출금 가능
    });
  }
});
