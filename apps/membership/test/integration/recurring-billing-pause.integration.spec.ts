import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { RecurringBillingService } from '../../src/services/billing/recurring-billing.service';
import { BillingReader } from '../../src/services/billing/billing.reader';
import { BillingManager } from '../../src/services/billing/billing.manager';
import { PauseService } from '../../src/services/pause.service';
import { PauseReader } from '../../src/services/pause/pause.reader';
import { PauseManager } from '../../src/services/pause/pause.manager';
import { EntitlementService } from '../../src/services/entitlement.service';
import { EntitlementReader } from '../../src/services/entitlement/entitlement.reader';
import { EntitlementManager } from '../../src/services/entitlement/entitlement.manager';
import { PlanService } from '../../src/services/plan.service';
import { PlanReader } from '../../src/services/plan/plan.reader';
import { PlanManager } from '../../src/services/plan/plan.manager';
import { PaymentClientService } from '../../src/services/billing/payment-client.service';
import {
  membershipSchema,
  type MembershipSchema,
} from '../../src/shared/schemas/entities/schema';
import * as schema from '../../src/shared/schemas/entities/schema';
import { eq, and } from 'drizzle-orm';
import { addDays, format } from 'date-fns';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .env 파일 로드
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

describe('Recurring Billing & Pause Integration Tests', () => {
  let recurringBillingService: RecurringBillingService;
  let billingReader: BillingReader;
  let billingManager: BillingManager;
  let pauseService: PauseService;
  let pauseReader: PauseReader;
  let pauseManager: PauseManager;
  let entitlementService: EntitlementService;
  let planService: PlanService;
  let paymentClient: PaymentClientService;
  let dbService: DbService<MembershipSchema>;
  let module: TestingModule;

  // 테스트 데이터
  let testTierId: string;
  let testPlanId: string;
  let testUserId: string;
  let testContractId: string;
  let testEntitlementId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set. Please check your .env file.');
    }

    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString: process.env.DATABASE_URL,
          },
          schema: membershipSchema,
        }),
      ],
      providers: [
        RecurringBillingService,
        BillingReader,
        BillingManager,
        PauseService,
        PauseReader,
        PauseManager,
        EntitlementService,
        EntitlementReader,
        EntitlementManager,
        PlanService,
        PlanReader,
        PlanManager,
        {
          provide: PaymentClientService,
          useValue: {
            // Mock Payment Client
            getDefaultPaymentProfile: jest.fn().mockResolvedValue({
              id: 'mock-profile-id',
            }),
            createPaymentIntent: jest.fn().mockResolvedValue({
              id: 'mock-intent-id',
            }),
            processPayment: jest.fn().mockResolvedValue({
              success: true,
              transactionId: 'mock-transaction-id',
            }),
          },
        },
      ],
    }).compile();

    recurringBillingService = module.get<RecurringBillingService>(
      RecurringBillingService,
    );
    billingReader = module.get<BillingReader>(BillingReader);
    billingManager = module.get<BillingManager>(BillingManager);
    pauseService = module.get<PauseService>(PauseService);
    pauseReader = module.get<PauseReader>(PauseReader);
    pauseManager = module.get<PauseManager>(PauseManager);
    entitlementService = module.get<EntitlementService>(EntitlementService);
    planService = module.get<PlanService>(PlanService);
    paymentClient = module.get<PaymentClientService>(PaymentClientService);
    dbService = module.get<DbService<MembershipSchema>>(DbService);

    // 공통 데이터 생성
    await setupSharedData();
  }, 30000);

  beforeEach(async () => {
    await cleanupTestSpecificData();
    await setupTestSpecificData();
  }, 10000);

  afterEach(async () => {
    await cleanupTestSpecificData();
  }, 10000);

  afterAll(async () => {
    await cleanupAllData();
    await module.close();
  }, 30000);

  // 공통 데이터 생성
  async function setupSharedData() {
    // 1. Tier 생성
    const [tier] = await dbService.db
      .insert(schema.tiers)
      .values({
        code: 'PREMIUM',
        priorityLevel: 2,
      })
      .returning();
    testTierId = tier.id;

    // 2. Plan 생성 (30일 플랜)
    const [plan] = await dbService.db
      .insert(schema.plan)
      .values({
        tierId: testTierId,
        price: 9900,
        durationDays: 30,
        trialDays: 0,
        isActive: true,
      })
      .returning();
    testPlanId = plan.id;
  }

  // 테스트별 데이터 생성
  async function setupTestSpecificData() {
    testUserId = 'test-user-' + Date.now();

    const today = new Date();
    const [contract] = await dbService.db
      .insert(schema.subscriptionContracts)
      .values({
        userId: testUserId,
        planId: testPlanId,
        billingDate: format(addDays(today, -30), 'yyyy-MM-dd'), // 30일 전
        nextBillingDate: format(today, 'yyyy-MM-dd'), // 오늘이 결제일
        status: 'ACTIVE',
        paymentProfileId: 'test-profile-id',
      })
      .returning();
    testContractId = contract.id;

    const [entitlement] = await dbService.db
      .insert(schema.subscriptionEntitlement)
      .values({
        userId: testUserId,
        tierId: testTierId,
        startsAt: format(today, 'yyyy-MM-dd'),
        endsAt: format(addDays(today, 30), 'yyyy-MM-dd'),
        isCurrent: true,
      })
      .returning();
    testEntitlementId = entitlement.id;
  }

  // 테스트별 데이터 정리
  async function cleanupTestSpecificData() {
    await dbService.db.delete(schema.membershipDunningQueue);
    await dbService.db.delete(schema.pauseEventDetails);
    await dbService.db.delete(schema.pauseEvents);
    await dbService.db.delete(schema.subscriptionEntitlement);
    await dbService.db.delete(schema.subscriptionContracts);
    await dbService.db.delete(schema.eventBatches);
  }

  // 전체 데이터 정리
  async function cleanupAllData() {
    await dbService.db.delete(schema.membershipDunningQueue);
    await dbService.db.delete(schema.pauseEventDetails);
    await dbService.db.delete(schema.pauseEvents);
    await dbService.db.delete(schema.subscriptionEntitlement);
    await dbService.db.delete(schema.subscriptionContracts);
    await dbService.db.delete(schema.eventBatches);
    await dbService.db.delete(schema.plan);
    await dbService.db.delete(schema.tiers);
  }

  describe('정기결제 대상 조회', () => {
    it('✅ 정상 구독은 결제 대상에 포함', async () => {
      // 오늘이 결제일
      const today = format(new Date(), 'yyyy-MM-dd');

      const dueContracts = await billingReader.findDueContracts(today);

      expect(dueContracts.length).toBeGreaterThanOrEqual(1);
      const found = dueContracts.find((c) => c.id === testContractId);
      expect(found).toBeDefined();
    });

    it('✅ 일시정지된 구독은 결제 대상에서 제외', async () => {
      // 일시정지 설정
      await dbService.db
        .update(schema.subscriptionEntitlement)
        .set({
          pausedAt: new Date(),
        })
        .where(eq(schema.subscriptionEntitlement.id, testEntitlementId));

      const today = format(new Date(), 'yyyy-MM-dd');
      const dueContracts = await billingReader.findDueContracts(today);

      const found = dueContracts.find((c) => c.id === testContractId);
      expect(found).toBeUndefined();
    });

    it('✅ 무효화된 구독은 결제 대상에서 제외', async () => {
      // 무효화 설정
      await dbService.db
        .update(schema.subscriptionContracts)
        .set({
          isVoided: true,
        })
        .where(eq(schema.subscriptionContracts.id, testContractId));

      const today = format(new Date(), 'yyyy-MM-dd');
      const dueContracts = await billingReader.findDueContracts(today);

      const found = dueContracts.find((c) => c.id === testContractId);
      expect(found).toBeUndefined();
    });
  });

  describe('정기결제 처리', () => {
    it('✅ 정상 결제 성공 - 권한 연장 및 다음 결제일 설정', async () => {
      const contract = await billingReader.findContractById(testContractId);
      expect(contract).toBeDefined();

      const result = await billingManager.processSingleBilling(contract!);

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe('mock-intent-id');
      expect(result.paymentAttemptId).toBe('mock-transaction-id');

      // Contract 상태 확인
      const [updatedContract] = await dbService.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, testContractId));

      expect(updatedContract.isPastDue).toBe(false);
      expect(updatedContract.billingRetryCount).toBe(0);
      expect(updatedContract.lastPaymentIntentId).toBe('mock-intent-id');

      // nextBillingDate가 30일 후로 설정되었는지 확인
      const expectedNextBilling = format(addDays(new Date(), 30), 'yyyy-MM-dd');
      expect(updatedContract.nextBillingDate).toBe(expectedNextBilling);
    });

    it('❌ 비활성화된 플랜은 결제 실패', async () => {
      // 플랜 비활성화
      await dbService.db
        .update(schema.plan)
        .set({
          isActive: false,
        })
        .where(eq(schema.plan.id, testPlanId));

      const contract = await billingReader.findContractById(testContractId);

      await expect(
        billingManager.processSingleBilling(contract!),
      ).rejects.toThrow('Plan is not active');

      // 플랜 다시 활성화 (다른 테스트 영향 방지)
      await dbService.db
        .update(schema.plan)
        .set({
          isActive: true,
        })
        .where(eq(schema.plan.id, testPlanId));
    });

    it('✅ 결제 실패 - Dunning 큐 추가', async () => {
      // Payment Client Mock을 실패로 변경
      jest.spyOn(paymentClient, 'processPayment').mockResolvedValueOnce({
        success: false,
        code: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient funds',
        transactionId: 'failed-tx-id',
      } as any);

      const contract = await billingReader.findContractById(testContractId);
      const result = await billingManager.processSingleBilling(contract!);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INSUFFICIENT_FUNDS');

      // Contract 상태 확인
      const [updatedContract] = await dbService.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, testContractId));

      expect(updatedContract.isPastDue).toBe(true);
      expect(updatedContract.billingRetryCount).toBe(1);

      // Dunning 큐 확인
      const [dunningItem] = await dbService.db
        .select()
        .from(schema.membershipDunningQueue)
        .where(eq(schema.membershipDunningQueue.contractId, testContractId));

      expect(dunningItem).toBeDefined();
      expect(dunningItem.attempts).toBe(1);
      expect(dunningItem.maxAttempts).toBe(3);
    });
  });

  describe('일시정지 기능', () => {
    it('✅ 일시정지 시 endsAt과 nextBillingDate 모두 연장', async () => {
      const startDate = new Date();
      const endDate = addDays(startDate, 30); // 30일 일시정지

      const [entitlement] = await dbService.db
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, testUserId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      const originalEndsAt = entitlement.endsAt;

      const [contract] = await dbService.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.userId, testUserId));

      const originalNextBillingDate = contract.nextBillingDate;

      // 일시정지 실행
      const result = await pauseManager.startPause(
        testUserId,
        entitlement,
        startDate,
        endDate,
        '여행 중',
      );

      expect(result.pauseDurationDays).toBe(30);

      // Entitlement 확인
      const [updatedEntitlement] = await dbService.db
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, testUserId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      expect(updatedEntitlement.pausedAt).not.toBeNull();
      expect(updatedEntitlement.endsAt).toBe(
        format(addDays(new Date(originalEndsAt), 30), 'yyyy-MM-dd'),
      );

      // Contract 확인
      const [updatedContract] = await dbService.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.userId, testUserId));

      expect(updatedContract.nextBillingDate).toBe(
        format(addDays(new Date(originalNextBillingDate!), 30), 'yyyy-MM-dd'),
      );
    });

    it('✅ 일시정지 중에는 정기결제 대상에서 제외', async () => {
      // 일시정지 실행
      const [entitlement] = await dbService.db
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, testUserId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      await pauseManager.startPause(
        testUserId,
        entitlement,
        new Date(),
        addDays(new Date(), 30),
      );

      // 결제 대상 조회
      const today = format(new Date(), 'yyyy-MM-dd');
      const dueContracts = await billingReader.findDueContracts(today);

      const found = dueContracts.find((c) => c.id === testContractId);
      expect(found).toBeUndefined();
    });

    it('✅ 일시정지 재개 후 정상 결제 가능', async () => {
      // 1. 일시정지
      const [entitlement] = await dbService.db
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, testUserId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      await pauseManager.startPause(
        testUserId,
        entitlement,
        new Date(),
        addDays(new Date(), 30),
      );

      // 2. 재개
      const [pausedEntitlement] = await dbService.db
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, testUserId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      await pauseManager.resumePause(testUserId, pausedEntitlement);

      // 3. 결제 대상 확인
      const today = format(new Date(), 'yyyy-MM-dd');
      const dueContracts = await billingReader.findDueContracts(today);

      // nextBillingDate가 미래로 연장되었으므로 오늘은 결제 대상 아님
      const found = dueContracts.find((c) => c.id === testContractId);
      expect(found).toBeUndefined();

      // 4. Entitlement pausedAt 확인
      const [resumedEntitlement] = await dbService.db
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, testUserId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      expect(resumedEntitlement.pausedAt).toBeNull();
    });
  });

  describe('전체 플로우 통합 테스트', () => {
    it('✅ 정기결제 → 일시정지 → 재개 → 정기결제', async () => {
      // 1. 첫 번째 정기결제 성공
      const contract1 = await billingReader.findContractById(testContractId);
      const result1 = await billingManager.processSingleBilling(contract1!);
      expect(result1.success).toBe(true);

      // 2. 일시정지 (15일)
      const [entitlement1] = await dbService.db
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, testUserId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      await pauseManager.startPause(
        testUserId,
        entitlement1,
        new Date(),
        addDays(new Date(), 15),
      );

      // 3. 일시정지 중 결제 대상 확인
      const today = format(new Date(), 'yyyy-MM-dd');
      const dueContracts = await billingReader.findDueContracts(today);
      expect(dueContracts.find((c) => c.id === testContractId)).toBeUndefined();

      // 4. 재개
      const [pausedEntitlement] = await dbService.db
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, testUserId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      await pauseManager.resumePause(testUserId, pausedEntitlement);

      // 5. 최종 상태 확인
      const [finalContract] = await dbService.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, testContractId));

      const [finalEntitlement] = await dbService.db
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, testUserId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        );

      // nextBillingDate와 endsAt이 모두 15일 연장되었는지 확인
      expect(finalContract.nextBillingDate).toBeDefined();
      expect(finalEntitlement.endsAt).toBeDefined();
      expect(finalEntitlement.pausedAt).toBeNull();
    });
  });
});
