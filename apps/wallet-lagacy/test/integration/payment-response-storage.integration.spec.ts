import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { walletSchema } from '../../src/shared/database/schema';
import * as schema from '../../src/shared/database/schema';
import { eq } from 'drizzle-orm';
import { PaymentAttemptRepository } from '../../src/services/payment/payment-attempt.repository';
import { BnplCmsResponseRepository } from '../../src/services/bnpl/bnpl-cms-response.repository';
import { BnplSettlementService } from '../../src/services/bnpl/bnpl-settlement.service';
import { BnplAccountService } from '../../src/services/bnpl-account.service';
import { ProviderType } from '../../src/providers/payment-provider.interface';
import { BnplBatchCreatorImpl } from '../../src/services/bnpl/bnpl-batch-creator.impl';
import { BnplCmsProcessorImpl } from '../../src/services/bnpl/bnpl-cms-processor.impl';
import { BnplRetryManagerImpl } from '../../src/services/bnpl/bnpl-retry-manager.impl';

/**
 * Payment Response Storage 통합 테스트
 *
 * 테스트 시나리오:
 * 1. Provider 응답 저장 테스트
 * 2. BNPL 전체 플로우 (주문 → 배치 → CMS 성공)
 * 3. BNPL 실패 및 재시도
 * 4. 에러 메시지 추출
 * 5. CMS 응답 이력 조회
 */
describe('Payment Response Storage (Integration)', () => {
  let module: TestingModule;
  let dbService: DbService<typeof walletSchema>;
  let attemptRepo: PaymentAttemptRepository;
  let cmsResponseRepo: BnplCmsResponseRepository;
  let settlementService: BnplSettlementService;
  let bnplAccountService: BnplAccountService;

  // 테스트 데이터 ID
  let testUserId: string;
  let testAccountId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
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
        PaymentAttemptRepository,
        BnplCmsResponseRepository,
        BnplSettlementService,
        BnplAccountService,
        BnplBatchCreatorImpl,
        BnplCmsProcessorImpl,
        BnplRetryManagerImpl,
      ],
    }).compile();

    dbService = module.get<DbService<typeof walletSchema>>(DbService);
    attemptRepo = module.get<PaymentAttemptRepository>(
      PaymentAttemptRepository,
    );
    cmsResponseRepo = module.get<BnplCmsResponseRepository>(
      BnplCmsResponseRepository,
    );
    settlementService = module.get<BnplSettlementService>(
      BnplSettlementService,
    );
    bnplAccountService = module.get<BnplAccountService>(BnplAccountService);
  });

  beforeEach(async () => {
    await cleanupDatabase();
    await setupTestData();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await module.close();
  });

  describe('Provider 응답 저장 테스트', () => {
    it('HMS_CARD provider 응답을 providerResponseSnapshot에 저장해야 한다', async () => {
      const intentId = 'intent-hms-card-001';
      const attemptId = 'attempt-hms-card-001';

      // Intent 생성
      await dbService.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testUserId,
        amount: 10000,
        totalAmount: 10000,
        finalAmount: 10000,
        status: 'PENDING',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 3600000),
      });

      // Attempt 생성 with HMS_CARD response
      const hmsCardResponse = {
        payment: {
          result: {
            code: '0000',
            message: 'Success',
          },
        },
        transactionId: 'HMS_TXN_123',
      };

      await attemptRepo.create(
        {
          attemptId,
          intentId,
          amount: 10000,
          instrumentType: 'PROFILE',
          profileId: 'profile-001',
          metadata: { orderId: 'order-001' },
        } as any,
        {
          success: true,
          transactionId: 'HMS_TXN_123',
          code: '0000',
          message: 'Success',
          raw: hmsCardResponse,
        },
        ProviderType.HMS_CARD,
        'AUTHORIZED',
      );

      // 저장된 데이터 확인
      const attempt = await attemptRepo.findById(attemptId);
      expect(attempt).toBeDefined();
      expect(attempt!.providerResponseSnapshot).toBeDefined();

      const snapshot =
        typeof attempt!.providerResponseSnapshot === 'string'
          ? JSON.parse(attempt!.providerResponseSnapshot)
          : attempt!.providerResponseSnapshot;

      expect(snapshot.payment.result.code).toBe('0000');
      expect(snapshot.transactionId).toBe('HMS_TXN_123');
    });

    it('TOSS provider 응답을 providerResponseSnapshot에 저장해야 한다', async () => {
      const intentId = 'intent-toss-001';
      const attemptId = 'attempt-toss-001';

      await dbService.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testUserId,
        amount: 20000,
        totalAmount: 20000,
        finalAmount: 20000,
        status: 'PENDING',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 3600000),
      });

      const tossResponse = {
        paymentKey: 'TOSS_KEY_123',
        orderId: 'order-002',
        status: 'DONE',
        totalAmount: 20000,
      };

      await attemptRepo.create(
        {
          attemptId,
          intentId,
          amount: 20000,
          instrumentType: 'ONE_TIME',
          metadata: { orderId: 'order-002' },
        } as any,
        {
          success: true,
          transactionId: 'TOSS_KEY_123',
          code: 'SUCCESS',
          message: 'Payment completed',
          raw: tossResponse,
        },
        ProviderType.TOSS,
        'CAPTURED',
      );

      const attempt = await attemptRepo.findById(attemptId);
      expect(attempt).toBeDefined();

      const snapshot =
        typeof attempt!.providerResponseSnapshot === 'string'
          ? JSON.parse(attempt!.providerResponseSnapshot)
          : attempt!.providerResponseSnapshot;

      expect(snapshot.paymentKey).toBe('TOSS_KEY_123');
      expect(snapshot.status).toBe('DONE');
    });
  });

  describe('에러 메시지 추출 테스트', () => {
    it('HMS_CARD 에러 메시지를 올바르게 추출해야 한다', async () => {
      const intentId = 'intent-error-hms';
      const attemptId = 'attempt-error-hms';

      await dbService.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testUserId,
        amount: 10000,
        totalAmount: 10000,
        finalAmount: 10000,
        status: 'PENDING',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 3600000),
      });

      const errorResponse = {
        payment: {
          result: {
            code: '9999',
            message: 'Card declined by issuer',
          },
        },
      };

      await attemptRepo.create(
        {
          attemptId,
          intentId,
          amount: 10000,
          instrumentType: 'PROFILE',
          metadata: {},
        } as any,
        {
          success: false,
          code: '9999',
          message: 'Card declined by issuer',
          raw: errorResponse,
        },
        ProviderType.HMS_CARD,
        'FAILED',
      );

      const attempt = await attemptRepo.findById(attemptId);
      const errorMessage = attemptRepo.getErrorMessage(attempt!);

      expect(errorMessage).toBe('Card declined by issuer');
    });

    it('TOSS 에러 메시지를 올바르게 추출해야 한다', async () => {
      const intentId = 'intent-error-toss';
      const attemptId = 'attempt-error-toss';

      await dbService.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testUserId,
        amount: 10000,
        totalAmount: 10000,
        finalAmount: 10000,
        status: 'PENDING',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 3600000),
      });

      const errorResponse = {
        code: 'INVALID_CARD_NUMBER',
        message: 'Invalid card number format',
      };

      await attemptRepo.create(
        {
          attemptId,
          intentId,
          amount: 10000,
          instrumentType: 'ONE_TIME',
          metadata: {},
        } as any,
        {
          success: false,
          code: 'INVALID_CARD_NUMBER',
          message: 'Invalid card number format',
          raw: errorResponse,
        },
        ProviderType.TOSS,
        'FAILED',
      );

      const attempt = await attemptRepo.findById(attemptId);
      const errorMessage = attemptRepo.getErrorMessage(attempt!);

      expect(errorMessage).toBe('Invalid card number format');
    });
  });

  describe('BNPL 전체 플로우 테스트', () => {
    it('주문 → 배치 생성 → CMS 성공 → CAPTURED 플로우가 정상 동작해야 한다', async () => {
      // 1. BNPL 주문 생성 (Intent + Attempt + Event)
      const intentId = 'intent-bnpl-001';
      const attemptId = 'attempt-bnpl-001';

      await dbService.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testUserId,
        amount: 50000,
        totalAmount: 50000,
        finalAmount: 50000,
        status: 'AUTHORIZED',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 3600000),
      });

      await attemptRepo.create(
        {
          attemptId,
          intentId,
          amount: 50000,
          instrumentType: 'PROFILE',
          metadata: { orderId: 'order-bnpl-001' },
        } as any,
        {
          success: true,
          transactionId: 'BNPL_TXN_001',
          code: '0000',
          message: 'Authorized',
          raw: { status: 'AUTHORIZED' },
        },
        ProviderType.HMS_BNPL,
        'AUTHORIZED',
      );

      await bnplAccountService.createCreditEvent(
        testUserId,
        50000,
        'order-bnpl-001',
        intentId,
      );

      // 2. 배치 생성
      const batch = await settlementService.createMonthlyBatch();
      expect(batch.batchId).toBeDefined();
      expect(batch.totalAmount).toBe(50000);
      expect(batch.eventCount).toBe(1);

      // 3. CMS 성공 처리
      await settlementService.processCmsResult(batch.batchId, true, {
        status: 'PROCESSED',
        approvalNumber: 'CMS_APPROVAL_123',
      });

      // 4. Attempt가 CAPTURED로 변경되었는지 확인
      const attempt = await attemptRepo.findById(attemptId);
      expect(attempt!.status).toBe('CAPTURED');

      // 5. Intent도 CAPTURED로 변경되었는지 확인
      const intent = await dbService.db.query.paymentIntents.findFirst({
        where: eq(schema.paymentIntents.id, intentId),
      });
      expect(intent!.status).toBe('CAPTURED');

      // 6. CMS 응답 이력 확인
      const history = await cmsResponseRepo.findByBatchId(batch.batchId);
      expect(history.length).toBeGreaterThanOrEqual(2); // REQUEST + RESULT
    });

    it('CMS 실패 → 재시도 → 성공 플로우가 정상 동작해야 한다', async () => {
      // 1. BNPL 주문 생성
      const intentId = 'intent-bnpl-retry-001';
      const attemptId = 'attempt-bnpl-retry-001';

      await dbService.db.insert(schema.paymentIntents).values({
        id: intentId,
        customerId: testUserId,
        amount: 30000,
        totalAmount: 30000,
        finalAmount: 30000,
        status: 'AUTHORIZED',
        type: 'ORDER',
        expiresAt: new Date(Date.now() + 3600000),
      });

      await attemptRepo.create(
        {
          attemptId,
          intentId,
          amount: 30000,
          instrumentType: 'PROFILE',
          metadata: { orderId: 'order-retry-001' },
        } as any,
        {
          success: true,
          transactionId: 'BNPL_TXN_RETRY_001',
          code: '0000',
          message: 'Authorized',
          raw: { status: 'AUTHORIZED' },
        },
        ProviderType.HMS_BNPL,
        'AUTHORIZED',
      );

      await bnplAccountService.createCreditEvent(
        testUserId,
        30000,
        'order-retry-001',
        intentId,
      );

      // 2. 배치 생성
      const batch = await settlementService.createMonthlyBatch();

      // 3. CMS 실패 처리
      await settlementService.processCmsResult(batch.batchId, false, {
        status: 'FAILED',
        errorCode: 'INSUFFICIENT_FUNDS',
        errorMessage: 'Insufficient funds in account',
      });

      // 4. Attempt가 FAILED로 변경되었는지 확인
      let attempt = await attemptRepo.findById(attemptId);
      expect(attempt!.status).toBe('FAILED');

      // 5. 재시도
      const newBatchId = await settlementService.retryFailedBatch(
        batch.batchId,
      );
      expect(newBatchId).toContain('_RETRY_1');

      // 6. 재시도 성공
      await settlementService.processCmsResult(newBatchId, true, {
        status: 'PROCESSED',
        approvalNumber: 'CMS_RETRY_SUCCESS',
      });

      // 7. Attempt가 CAPTURED로 변경되었는지 확인
      attempt = await attemptRepo.findById(attemptId);
      expect(attempt!.status).toBe('CAPTURED');

      // 8. 재시도 이력 확인
      const retryHistory = await cmsResponseRepo.findByBatchId(newBatchId);
      expect(retryHistory.length).toBeGreaterThanOrEqual(2);
      expect(
        retryHistory.some((h) => h.responseType === 'BATCH_RETRY_ATTEMPTED'),
      ).toBe(true);
    }, 10000); // 10초 타임아웃
  });

  describe('CMS 응답 이력 조회 테스트', () => {
    it('배치 ID로 CMS 응답 이력을 조회할 수 있어야 한다', async () => {
      const batchId = 'test-batch-001';

      // CMS 응답 기록
      await cmsResponseRepo.createResponse({
        batchId,
        accountId: testAccountId,
        responseType: 'BATCH_REQUEST_SUBMITTED',
        cmsResponseSnapshot: {
          batchId,
          status: 'REQUESTED',
          totalAmount: 100000,
        },
        newStatus: 'REQUESTED',
      });

      await cmsResponseRepo.createResponse({
        batchId,
        accountId: testAccountId,
        responseType: 'BATCH_RESULT_CONFIRMED',
        cmsResponseSnapshot: {
          batchId,
          status: 'PROCESSED',
          approvalNumber: 'CMS_123',
        },
        previousStatus: 'REQUESTED',
        newStatus: 'PROCESSED',
      });

      // 이력 조회
      const history = await cmsResponseRepo.findByBatchId(batchId);
      expect(history).toHaveLength(2);
      expect(history[0].responseType).toBe('BATCH_RESULT_CONFIRMED'); // 최신순
      expect(history[1].responseType).toBe('BATCH_REQUEST_SUBMITTED');
    });

    it('계정 ID로 CMS 응답 이력을 조회할 수 있어야 한다', async () => {
      // 여러 배치에 대한 응답 기록
      await cmsResponseRepo.createResponse({
        batchId: 'batch-001',
        accountId: testAccountId,
        responseType: 'BATCH_REQUEST_SUBMITTED',
        cmsResponseSnapshot: { status: 'REQUESTED' },
        newStatus: 'REQUESTED',
      });

      await cmsResponseRepo.createResponse({
        batchId: 'batch-002',
        accountId: testAccountId,
        responseType: 'BATCH_REQUEST_SUBMITTED',
        cmsResponseSnapshot: { status: 'REQUESTED' },
        newStatus: 'REQUESTED',
      });

      // 계정별 이력 조회
      const history = await cmsResponseRepo.findByAccountId(testAccountId);
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('최신 CMS 응답을 조회할 수 있어야 한다', async () => {
      const batchId = 'test-batch-latest';

      await cmsResponseRepo.createResponse({
        batchId,
        accountId: testAccountId,
        responseType: 'BATCH_REQUEST_SUBMITTED',
        cmsResponseSnapshot: { status: 'REQUESTED' },
        newStatus: 'REQUESTED',
      });

      // 약간의 지연
      await new Promise((resolve) => setTimeout(resolve, 10));

      await cmsResponseRepo.createResponse({
        batchId,
        accountId: testAccountId,
        responseType: 'BATCH_RESULT_CONFIRMED',
        cmsResponseSnapshot: { status: 'PROCESSED' },
        previousStatus: 'REQUESTED',
        newStatus: 'PROCESSED',
      });

      // 최신 응답 조회
      const latest = await cmsResponseRepo.findLatestByBatchId(batchId);
      expect(latest).toBeDefined();
      expect(latest!.responseType).toBe('BATCH_RESULT_CONFIRMED');
      expect(latest!.newStatus).toBe('PROCESSED');
    });
  });

  // 청소 함수
  async function cleanupDatabase() {
    try {
      await dbService.db.delete(schema.bnplCmsResponses);
      await dbService.db.delete(schema.bnplEventDetails);
      await dbService.db.delete(schema.bnplEvents);
      await dbService.db.delete(schema.paymentRefunds);
      await dbService.db.delete(schema.paymentAttempts);
      await dbService.db.delete(schema.paymentIntents);
      await dbService.db.delete(schema.bnplAccounts);
    } catch (error) {
      console.warn('청소 중 에러 발생:', error);
    }
  }

  // 테스트 데이터 생성
  async function setupTestData() {
    testUserId = 'test-user-' + Date.now();

    // BNPL 계정 생성
    const account = await bnplAccountService.createBnplAccount(
      testUserId,
      1000000,
    );
    testAccountId = account.id;
  }
});
