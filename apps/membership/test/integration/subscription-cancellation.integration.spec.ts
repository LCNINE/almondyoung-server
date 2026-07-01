import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { SubscriptionCancellationService } from '../../src/services/subscription-cancellation.service';
import { SubscriptionCancellationManager } from '../../src/services/subscription/subscription-cancellation.manager';
import { SubscriptionContractReader } from '../../src/services/subscription/subscription-contract.reader';
import { ContractEventManager } from '../../src/services/subscription/contract-event.manager';
import { CancellationReasonReader } from '../../src/services/subscription/cancellation-reason.reader';
import { RefundEventHandler } from '../../src/services/refund-event-handler.service';
import { SubscriptionService } from '../../src/services/subscription.service';
import { SubscriptionCreator } from '../../src/services/subscription/subscription.creator';
import { SubscriptionManager } from '../../src/services/subscription/subscription.manager';
import { EntitlementService } from '../../src/services/entitlement.service';
import { EntitlementReader } from '../../src/services/entitlement/entitlement.reader';
import { EntitlementManager } from '../../src/services/entitlement/entitlement.manager';
import { PlanService } from '../../src/services/plan.service';
import { PlanReader } from '../../src/services/plan/plan.reader';
import { PlanManager } from '../../src/services/plan/plan.manager';
import { MembershipPolicyService } from '../../src/services/membership-policy.service';
import { MembershipEventPublisher } from '../../src/services/membership-event.publisher';
import { PaymentClientService } from '../../src/services/billing/payment-client.service';
import { BillingManager } from '../../src/services/billing/billing.manager';
import { BillingReader } from '../../src/services/billing/billing.reader';
import { membershipSchema, type MembershipSchema } from '../../src/shared/schemas/entities/schema';
import * as schema from '../../src/shared/schemas/entities/schema';
import { eq } from 'drizzle-orm';
import { addDays } from 'date-fns';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .env 파일 로드
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

describe('Subscription Cancellation Integration Tests', () => {
  let cancellationService: SubscriptionCancellationService;
  let contractEventManager: ContractEventManager;
  let cancellationReasonReader: CancellationReasonReader;
  let refundEventHandler: RefundEventHandler;
  let dbService: DbService<MembershipSchema>;
  let module: TestingModule;

  // 테스트 데이터
  let testTierId: string;
  let testPlanId: string;
  let testUserId: string;
  let testContractId: string;

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
        SubscriptionCancellationService,
        SubscriptionCancellationManager,
        SubscriptionContractReader,
        ContractEventManager,
        CancellationReasonReader,
        RefundEventHandler,
        // 무료 체험 테스트를 위한 추가 providers
        SubscriptionService,
        SubscriptionCreator,
        SubscriptionManager,
        EntitlementService,
        EntitlementReader,
        EntitlementManager,
        PlanService,
        PlanReader,
        PlanManager,
        // 정책 서비스
        MembershipPolicyService,
        // BillingReader는 DbService만 의존하므로 실제 사용. 외부 부수효과 서비스(이벤트/결제/빌링커맨드)는
        // 취소 통합테스트 대상이 아니므로 mock으로 대체한다.
        BillingReader,
        {
          provide: MembershipEventPublisher,
          useValue: { publishStatusChanged: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: PaymentClientService,
          useValue: {
            directCharge: jest.fn(),
            refundMembershipPayment: jest.fn(),
            revokeBillingAgreement: jest.fn(),
          },
        },
        {
          provide: BillingManager,
          useValue: { processSingleBilling: jest.fn() },
        },
      ],
    }).compile();

    cancellationService = module.get<SubscriptionCancellationService>(SubscriptionCancellationService);
    contractEventManager = module.get<ContractEventManager>(ContractEventManager);
    cancellationReasonReader = module.get<CancellationReasonReader>(CancellationReasonReader);
    refundEventHandler = module.get<RefundEventHandler>(RefundEventHandler);
    dbService = module.get<DbService<MembershipSchema>>(DbService);

    // 공통 데이터 한 번만 생성 (Tier, Plan, CancellationReasons)
    await setupSharedData();
  }, 30000);

  beforeEach(async () => {
    // 테스트별로 변경되는 데이터만 cleanup & setup
    await cleanupTestSpecificData();
    await setupTestSpecificData();
  }, 10000);

  afterEach(async () => {
    await cleanupTestSpecificData();
  }, 10000);

  afterAll(async () => {
    // 전체 cleanup
    await cleanupAllData();
    await module.close();
  }, 30000);

  // 공통 데이터 한 번만 생성 (모든 테스트에서 재사용)
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

    // 2. Plan 생성 (7일 무료 체험)
    const [plan] = await dbService.db
      .insert(schema.plan)
      .values({
        tierId: testTierId,
        price: 9900,
        durationDays: 30,
        trialDays: 7,
        isActive: true,
      })
      .returning();
    testPlanId = plan.id;

    // 3. 취소 이유 생성
    await dbService.db.insert(schema.cancellationReasons).values([
      {
        code: 'TRIAL_PERIOD',
        displayText: '더 나은 서비스를 위해 노력하겠습니다',
        category: 'TRIAL',
        sortOrder: 1,
        isActive: true,
      },
      {
        code: 'PRICE_TOO_HIGH',
        displayText: '가격이 저렴하지 않습니다',
        category: 'PRICE',
        sortOrder: 2,
        isActive: true,
      },
    ]);
  }

  // 테스트별 데이터 생성 (매 테스트마다 새로 생성)
  async function setupTestSpecificData() {
    testUserId = 'test-user-' + Date.now();

    const billingDate = new Date();
    const [contract] = await dbService.db
      .insert(schema.subscriptionContracts)
      .values({
        userId: testUserId,
        planId: testPlanId,
        billingDate: billingDate.toISOString().split('T')[0],
        nextBillingDate: addDays(billingDate, 30).toISOString().split('T')[0],
        status: 'ACTIVE',
      })
      .returning();
    testContractId = contract.id;

    await dbService.db.insert(schema.subscriptionEntitlement).values({
      userId: testUserId,
      tierId: testTierId,
      startsAt: billingDate.toISOString().split('T')[0],
      endsAt: addDays(billingDate, 37).toISOString().split('T')[0],
      isCurrent: true,
    });
  }

  // 테스트별 데이터만 삭제
  async function cleanupTestSpecificData() {
    await dbService.db.delete(schema.subscriptionContractEvents);
    await dbService.db.delete(schema.subscriptionEntitlement);
    await dbService.db.delete(schema.subscriptionContracts);
    await dbService.db.delete(schema.eventBatches);
  }

  // 전체 데이터 삭제 (afterAll에서만 사용)
  async function cleanupAllData() {
    await dbService.db.delete(schema.subscriptionContractEvents);
    await dbService.db.delete(schema.subscriptionEntitlement);
    await dbService.db.delete(schema.subscriptionContracts);
    await dbService.db.delete(schema.eventBatches);
    await dbService.db.delete(schema.cancellationReasons);
    await dbService.db.delete(schema.plan);
    await dbService.db.delete(schema.tiers);
  }

  describe('Task 2: 이벤트 소싱 및 취소 이유 서비스', () => {
    it('✅ 취소 이유 목록 조회', async () => {
      const reasons = await cancellationReasonReader.findActiveReasons();

      expect(reasons).toHaveLength(2);
      expect(reasons[0].code).toBe('TRIAL_PERIOD');
      expect(reasons[1].code).toBe('PRICE_TOO_HIGH');
    });

    it('✅ 취소 이유 코드로 조회', async () => {
      const reason = await cancellationReasonReader.findByCode('TRIAL_PERIOD');

      expect(reason).toBeDefined();
      expect(reason?.displayText).toBe('더 나은 서비스를 위해 노력하겠습니다');
    });

    it('✅ 계약 이벤트 조회', async () => {
      // 이벤트 추가
      await dbService.db.transaction(async (tx) => {
        await contractEventManager.addEvent(tx, testContractId, 'CREATED', { planId: testPlanId }, 'USER', testUserId);
      });

      const events = await contractEventManager.getContractEvents(testContractId);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('CREATED');
    });
  });

  describe('Task 3: 일반 구독 취소 (무료 체험 기간 중)', () => {
    it('✅ 무료 체험 기간 중 취소 - 전액 환불', async () => {
      const result = await cancellationService.cancelSubscription(testUserId, 'TRIAL_PERIOD', '체험 기간 중 취소');

      expect(result.status).toBe('CANCELLED');
      if (result.type === 'IMMEDIATE_CANCELLATION') {
        expect(result.refundEligible).toBe(true);
        expect(result.refundAmount).toBe(9900);
        expect(result.refundStatus).toBe('PENDING');
      }

      // DB 상태 확인
      const [contract] = await dbService.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, testContractId));

      expect(contract.status).toBe('CANCELLED');
      expect(contract.refundRequested).toBe(true);
      expect(contract.eligibleRefundAmount).toBe(9900);

      // 이벤트 확인
      const events = await contractEventManager.getContractEvents(testContractId);
      expect(events.length).toBeGreaterThanOrEqual(2); // CANCELLED, REFUND_REQUESTED
      expect(events.some((e) => e.eventType === 'CANCELLED')).toBe(true);
      expect(events.some((e) => e.eventType === 'REFUND_REQUESTED')).toBe(true);
    });

    it('✅ 무료 체험 기간 후 취소 - 환불 불가', async () => {
      // 계약 날짜를 8일 전으로 변경 (체험 기간 지남)
      const pastDate = addDays(new Date(), -8);
      await dbService.db
        .update(schema.subscriptionContracts)
        .set({
          billingDate: pastDate.toISOString().split('T')[0],
        })
        .where(eq(schema.subscriptionContracts.id, testContractId));

      const result = await cancellationService.cancelSubscription(testUserId, 'PRICE_TOO_HIGH');

      if (result.type === 'RECURRING_CANCELLATION') {
        expect(result.status).toBe('RECURRING_CANCELLED');
        expect(result.refundEligible).toBe(false);
      } else {
        expect(result.status).toBe('CANCELLED');
        expect(result.refundEligible).toBe(false);
        expect(result.refundAmount).toBe(0);
        expect(result.refundStatus).toBe('NOT_APPLICABLE');
      }
    });

    it('❌ 중복 취소 시도 - 에러', async () => {
      // 첫 번째 취소
      await cancellationService.cancelSubscription(testUserId, 'TRIAL_PERIOD');

      // 두 번째 취소 시도
      await expect(cancellationService.cancelSubscription(testUserId, 'TRIAL_PERIOD')).rejects.toThrow(
        'Contract already cancelled',
      );
    });
  });

  describe('Task 4: 강제 구독 취소 (어드민)', () => {
    it('✅ 강제 취소 - FULL 환불', async () => {
      const result = await cancellationService.forceCancelSubscription(
        testContractId,
        'admin-001',
        '시스템 장애',
        'FULL',
        undefined,
        '서비스 불가로 인한 전액 환불',
      );

      expect(result.status).toBe('CANCELLED');
      expect(result.refundAmount).toBe(9900);
      expect(result.refundStatus).toBe('PENDING');

      // 이벤트 확인
      const events = await contractEventManager.getContractEvents(testContractId);
      const cancelEvent = events.find((e) => e.eventType === 'CANCELLED');
      expect(cancelEvent?.metadata).toMatchObject({
        isForced: true,
        adminId: 'admin-001',
      });
    });

    it('✅ 강제 취소 - PARTIAL 환불', async () => {
      const result = await cancellationService.forceCancelSubscription(
        testContractId,
        'admin-001',
        '부분 환불',
        'PARTIAL',
        5000,
      );

      expect(result.refundAmount).toBe(5000);
    });

    it('✅ 강제 취소 - NONE 환불', async () => {
      const result = await cancellationService.forceCancelSubscription(
        testContractId,
        'admin-001',
        '환불 없음',
        'NONE',
      );

      expect(result.refundAmount).toBe(0);
      expect(result.refundStatus).toBe('NOT_APPLICABLE');
    });

    it('❌ PARTIAL 환불 금액 초과 - 에러', async () => {
      await expect(
        cancellationService.forceCancelSubscription(
          testContractId,
          'admin-001',
          '초과 환불',
          'PARTIAL',
          15000, // plan.price(9900)보다 큼
        ),
      ).rejects.toThrow('Refund amount exceeds plan price');
    });
  });

  describe('Task 6: Wallet 환불 이벤트 처리', () => {
    beforeEach(async () => {
      // 취소 상태로 만들기
      await cancellationService.cancelSubscription(testUserId, 'TRIAL_PERIOD');
    });

    it('✅ 환불 완료 이벤트 처리', async () => {
      await refundEventHandler.handleRefundCompleted({
        contractId: testContractId,
        userId: testUserId,
        amount: 9900,
        walletTransactionId: 'wallet-tx-123',
        completedAt: new Date().toISOString(),
      });

      // DB 상태 확인
      const [contract] = await dbService.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, testContractId));

      expect(contract.refundCompleted).toBe(true);
      expect(contract.walletReferenceId).toBe('wallet-tx-123');

      // 이벤트 확인
      const events = await contractEventManager.getContractEvents(testContractId);
      expect(events.some((e) => e.eventType === 'REFUND_COMPLETED')).toBe(true);
    });

    it('✅ 환불 완료 이벤트 멱등성 - 중복 처리 스킵', async () => {
      const event = {
        contractId: testContractId,
        userId: testUserId,
        amount: 9900,
        walletTransactionId: 'wallet-tx-123',
        completedAt: new Date().toISOString(),
      };

      // 첫 번째 처리
      await refundEventHandler.handleRefundCompleted(event);

      // 두 번째 처리 (멱등성)
      await refundEventHandler.handleRefundCompleted(event);

      // 이벤트가 중복 생성되지 않았는지 확인
      const events = await contractEventManager.getContractEvents(testContractId);
      const refundCompletedEvents = events.filter((e) => e.eventType === 'REFUND_COMPLETED');
      expect(refundCompletedEvents).toHaveLength(1);
    });

    it('✅ 환불 실패 이벤트 처리', async () => {
      await refundEventHandler.handleRefundFailed({
        contractId: testContractId,
        userId: testUserId,
        errorMessage: 'Insufficient balance',
      });

      // 이벤트 확인
      const events = await contractEventManager.getContractEvents(testContractId);
      const failEvent = events.find((e) => e.eventType === 'REFUND_FAILED');
      expect(failEvent).toBeDefined();
      expect(failEvent?.metadata).toMatchObject({
        errorMessage: 'Insufficient balance',
      });
    });

    it('❌ 존재하지 않는 계약 - 에러', async () => {
      await expect(
        refundEventHandler.handleRefundCompleted({
          contractId: 'non-existent-id',
          userId: testUserId,
          amount: 9900,
          walletTransactionId: 'wallet-tx-123',
          completedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow('Contract not found');
    });
  });

  describe('Task 7: 이벤트 소싱 통합 확인', () => {
    it('✅ 전체 플로우 이벤트 추적', async () => {
      // 1. 취소
      await cancellationService.cancelSubscription(testUserId, 'TRIAL_PERIOD');

      // 2. 환불 완료
      await refundEventHandler.handleRefundCompleted({
        contractId: testContractId,
        userId: testUserId,
        amount: 9900,
        walletTransactionId: 'wallet-tx-123',
        completedAt: new Date().toISOString(),
      });

      // 전체 이벤트 확인
      const events = await contractEventManager.getContractEvents(testContractId);

      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events.some((e) => e.eventType === 'CANCELLED')).toBe(true);
      expect(events.some((e) => e.eventType === 'REFUND_REQUESTED')).toBe(true);
      expect(events.some((e) => e.eventType === 'REFUND_COMPLETED')).toBe(true);

      // 시간 순서 확인
      const sortedEvents = events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      expect(sortedEvents[0].eventType).toBe('CANCELLED');
    });
  });

  describe('Task 8: 무료 체험 악용 방지', () => {
    let subscriptionService: SubscriptionService;

    beforeAll(async () => {
      // 이미 module에서 주입된 서비스 사용
      subscriptionService = module.get<SubscriptionService>(SubscriptionService);
    });

    it('✅ 첫 구독 시 무료 체험 적용 (7일)', async () => {
      const newUserId = 'trial-test-user-' + Date.now();

      const result = await subscriptionService.createSubscription(newUserId, testPlanId);

      // 이벤트 확인
      const events = await contractEventManager.getContractEvents(result.contractId);
      const createdEvent = events.find((e) => e.eventType === 'CREATED');

      expect(createdEvent?.metadata).toMatchObject({
        trialDays: 7,
        effectiveTrialDays: 7,
        isFirstTimeSubscriber: true,
      });

      // Cleanup
      await dbService.db
        .delete(schema.subscriptionContractEvents)
        .where(eq(schema.subscriptionContractEvents.contractId, result.contractId));
      await dbService.db
        .delete(schema.subscriptionEntitlement)
        .where(eq(schema.subscriptionEntitlement.userId, newUserId));
      await dbService.db.delete(schema.subscriptionContracts).where(eq(schema.subscriptionContracts.userId, newUserId));
    });

    it('✅ 재구독 시 무료 체험 미적용 (0일)', async () => {
      const newUserId = 'trial-test-user-' + Date.now();

      // 1. 첫 구독
      await subscriptionService.createSubscription(newUserId, testPlanId);

      // 2. 취소
      await cancellationService.cancelSubscription(newUserId, 'TRIAL_PERIOD', '체험 후 결정');

      // 3. 재구독
      const secondResult = await subscriptionService.createSubscription(newUserId, testPlanId);

      // 이벤트 확인
      const events = await contractEventManager.getContractEvents(secondResult.contractId);
      const createdEvent = events.find((e) => e.eventType === 'CREATED');

      expect(createdEvent?.metadata).toMatchObject({
        trialDays: 7, // 플랜의 체험 기간
        effectiveTrialDays: 0, // 실제 적용된 체험 기간 (0일)
        isFirstTimeSubscriber: false, // 재구독
      });

      // Cleanup
      await dbService.db
        .delete(schema.subscriptionContractEvents)
        .where(eq(schema.subscriptionContractEvents.userId, newUserId));
      await dbService.db
        .delete(schema.subscriptionEntitlement)
        .where(eq(schema.subscriptionEntitlement.userId, newUserId));
      await dbService.db.delete(schema.subscriptionContracts).where(eq(schema.subscriptionContracts.userId, newUserId));
    }, 20000); // 타임아웃 20초

    it('✅ 여러 번 취소 후 재구독해도 무료 체험 미적용', async () => {
      const newUserId = 'trial-test-user-' + Date.now();

      // 1차: 구독 → 취소
      await subscriptionService.createSubscription(newUserId, testPlanId);
      await cancellationService.cancelSubscription(newUserId, 'TRIAL_PERIOD');

      // 2차: 재구독 → 취소
      await subscriptionService.createSubscription(newUserId, testPlanId);
      await cancellationService.cancelSubscription(newUserId, 'TRIAL_PERIOD');

      // 3차: 재구독
      const thirdResult = await subscriptionService.createSubscription(newUserId, testPlanId);

      const events = await contractEventManager.getContractEvents(thirdResult.contractId);
      const createdEvent = events.find((e) => e.eventType === 'CREATED');

      expect(createdEvent?.metadata).toMatchObject({
        effectiveTrialDays: 0,
        isFirstTimeSubscriber: false,
      });

      // Cleanup
      await dbService.db
        .delete(schema.subscriptionContractEvents)
        .where(eq(schema.subscriptionContractEvents.userId, newUserId));
      await dbService.db
        .delete(schema.subscriptionEntitlement)
        .where(eq(schema.subscriptionEntitlement.userId, newUserId));
      await dbService.db.delete(schema.subscriptionContracts).where(eq(schema.subscriptionContracts.userId, newUserId));
    }, 30000); // 타임아웃 30초
  });
});
