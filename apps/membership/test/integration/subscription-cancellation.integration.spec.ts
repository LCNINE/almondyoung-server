import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { SubscriptionCancellationService } from '../../src/services/subscription-cancellation.service';
import { SubscriptionCancellationManager } from '../../src/services/subscription/subscription-cancellation.manager';
import { SubscriptionContractReader } from '../../src/services/subscription/subscription-contract.reader';
import { ContractEventManager } from '../../src/services/subscription/contract-event.manager';
import { CancellationReasonReader } from '../../src/services/subscription/cancellation-reason.reader';
import { RefundEventHandler } from '../../src/services/refund-event-handler.service';
import { RefundPolicyService } from '../../src/services/subscription/refund-policy.service';
import { CancellationContextReader } from '../../src/services/subscription/cancellation-context.reader';
import { BenefitReader } from '../../src/services/benefit/benefit.reader';
import { PauseReader } from '../../src/services/pause/pause.reader';
import { PauseManager } from '../../src/services/pause/pause.manager';
import { SavingsService } from '../../src/services/savings/savings.service';
import { SavingsReader } from '../../src/services/savings/savings.reader';
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
import { InvoiceBillingManager } from '../../src/services/billing/invoice-billing.manager';
import { ConfigService } from '@nestjs/config';
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
        // 해지 정책 + 사실 수집 (미리보기와 실행이 같은 판단을 쓰는지 함께 검증)
        RefundPolicyService,
        CancellationContextReader,
        BenefitReader,
        // 정지 일수는 연간 정산의 '이용한 기간' 계산에 직접 들어간다 — mock 하면 정산 금액 검증이 무의미해진다.
        PauseReader,
        PauseManager,
        // 절약액 집계는 구독 이력 응답에 실려 나간다 — 실제 구현을 써야 판정과 같은 원장을 보는지 확인된다.
        SavingsService,
        SavingsReader,
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
            directCharge: jest.fn().mockResolvedValue(undefined),
            refundMembershipPayment: jest.fn().mockResolvedValue(undefined),
            refundByIntent: jest.fn().mockResolvedValue({ status: 'SUCCEEDED', refundedAmount: 0 }),
            getRefundability: jest.fn().mockResolvedValue({
              intentId: 'intent',
              refundableAmount: 0,
              alreadyRefundedAmount: 0,
              autoRefundSupported: true,
              requiresReceiveAccount: false,
              methodTypes: ['TOSS'],
            }),
            createBillingAgreement: jest.fn().mockResolvedValue(undefined),
            // async 메서드라 항상 Promise 를 반환한다 — fire-and-forget `.catch()` 대상이므로 반드시 resolved promise.
            revokeBillingAgreement: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: BillingManager,
          useValue: { processSingleBilling: jest.fn() },
        },
        {
          provide: InvoiceBillingManager,
          useValue: {
            issueInvoiceForContract: jest.fn().mockResolvedValue({ success: true }),
            voidInvoicesForContract: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
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
    it('✅ 무료 체험 기간 중 취소 - 정기결제 중단(환불 없음)', async () => {
      // 정책: 고객 셀프 해지는 무료체험 중이어도 환불하지 않고 정기결제만 중단한다(RECURRING_CANCELLED).
      // 자격은 기간말까지 유지되므로 계약 status 는 ACTIVE 로 남고 autoRenewal 만 꺼진다.
      const result = await cancellationService.cancelSubscription(testUserId, 'test@example.com', { reasonCode: 'TRIAL_PERIOD', reasonText: '체험 기간 중 취소' });

      expect(result.type).toBe('RECURRING_CANCELLATION');
      expect(result.status).toBe('RECURRING_CANCELLED');
      if (result.type === 'RECURRING_CANCELLATION') {
        expect(result.refundEligible).toBe(false);
        expect(result.autoRenewal).toBe(false);
      }

      // DB 상태 확인 — 자격 유지라 status 는 ACTIVE, autoRenewal 만 해제, 환불 없음
      const [contract] = await dbService.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, testContractId));

      expect(contract.status).toBe('ACTIVE');
      expect(contract.autoRenewal).toBe(false);
      expect(contract.refundRequested).toBe(false);

      // 이벤트 확인 — RECURRING_CANCELLED 만, 환불 이벤트 없음
      const events = await contractEventManager.getContractEvents(testContractId);
      expect(events.some((e) => e.eventType === 'RECURRING_CANCELLED')).toBe(true);
      expect(events.some((e) => e.eventType === 'REFUND_REQUESTED')).toBe(false);
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

      const result = await cancellationService.cancelSubscription(testUserId, 'test@example.com', { reasonCode: 'PRICE_TOO_HIGH' });

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

    it('✅ 정기해지 후 재해지 - 409 로 막아 해지 시각을 보존한다', async () => {
      // 재해지를 통과시키면 recurringCancelledAt 이 새 시각으로 덮여 "언제 해지했는지"가 사라진다.
      // 고객 화면은 해지 예약 상태에서 해지 버튼을 숨기므로, 여기 도달하는 건 중복 제출뿐이다.
      const first = await cancellationService.cancelSubscription(testUserId, 'test@example.com', { reasonCode: 'TRIAL_PERIOD' });
      expect(first.status).toBe('RECURRING_CANCELLED');
      const cancelledAt = (first as { recurringCancelledAt: Date }).recurringCancelledAt;

      await expect(
        cancellationService.cancelSubscription(testUserId, 'test@example.com', { reasonCode: 'TRIAL_PERIOD' }),
      ).rejects.toThrow('이미 해지 예약된 구독입니다');

      const [contract] = await dbService.db
        .select({ recurringCancelledAt: schema.subscriptionContracts.recurringCancelledAt })
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, testContractId))
        .limit(1);
      expect(contract.recurringCancelledAt?.getTime()).toBe(cancelledAt.getTime());
    });
  });

  describe('Task 4: 강제 구독 취소 (어드민)', () => {
    // 환불 금액 산정을 보려면 환불 대상 결제가 있어야 한다. 기본 fixture 는 결제 전 계약이므로
    // 이 그룹에서만 결제 intent 를 붙인다(intent 없는 계약의 거절은 아래 별도 테스트가 덮는다).
    beforeEach(async () => {
      await dbService.db
        .update(schema.subscriptionContracts)
        .set({ lastPaymentIntentId: 'intent_001' })
        .where(eq(schema.subscriptionContracts.id, testContractId));
    });

    it('❌ 결제 내역 없는 계약의 환불 - 거절', async () => {
      await dbService.db
        .update(schema.subscriptionContracts)
        .set({ lastPaymentIntentId: null })
        .where(eq(schema.subscriptionContracts.id, testContractId));

      // 관리자 지급·이관 계약은 돌려줄 결제가 없다. PENDING 으로 표시하면 환불이 진행 중이라고 오인한다.
      await expect(
        cancellationService.forceCancelSubscription(testContractId, 'admin-001', '시스템 장애', 'FULL'),
      ).rejects.toThrow('환불 대상 결제 내역이 없습니다');
    });

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
      expect(result.refundStatus).toBe('COMPLETED');

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
        // 정책 산정액·관리자 재량 한도(월 정가)를 넘는 환불은 별도 권한이 필요하다.
      ).rejects.toThrow('초과 환불에는 별도 권한');
    });
  });

  describe('Task 6: Wallet 환불 이벤트 처리', () => {
    beforeEach(async () => {
      // 취소 상태로 만들기
      await cancellationService.cancelSubscription(testUserId, 'test@example.com', { reasonCode: 'TRIAL_PERIOD' });
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
      await cancellationService.cancelSubscription(testUserId, 'test@example.com', { reasonCode: 'TRIAL_PERIOD' });

      // 2. 환불 완료
      await refundEventHandler.handleRefundCompleted({
        contractId: testContractId,
        userId: testUserId,
        amount: 9900,
        walletTransactionId: 'wallet-tx-123',
        completedAt: new Date().toISOString(),
      });

      // 전체 이벤트 확인 — 셀프해지는 RECURRING_CANCELLED(환불 없음), REFUND_COMPLETED 는 위에서 수동 주입.
      const events = await contractEventManager.getContractEvents(testContractId);

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.some((e) => e.eventType === 'RECURRING_CANCELLED')).toBe(true);
      expect(events.some((e) => e.eventType === 'REFUND_COMPLETED')).toBe(true);
      // 셀프해지는 즉시취소/자동환불을 만들지 않는다
      expect(events.some((e) => e.eventType === 'CANCELLED')).toBe(false);
      expect(events.some((e) => e.eventType === 'REFUND_REQUESTED')).toBe(false);

      // 시간 순서 확인 — 정기해지가 먼저
      const sortedEvents = events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      expect(sortedEvents[0].eventType).toBe('RECURRING_CANCELLED');
    });
  });

  // 무료체험(trial)은 recurring 정기결제 첫 구독자 전용이다(subscription.creator: billingMode==='recurring'
  // 일 때만 effectiveTrialDays 적용). 그런데 공개 createSubscription 은 one_time 이라 항상 trial=0 이고,
  // 셀프해지는 자격을 기간말까지 남겨(status ACTIVE 유지) 재구독이 ActiveSubscriptionExists 로 막힌다.
  // 즉 이 스위트는 recurring 전용 기능을 one_time 경로로 검증하려는 구조적 미스매치다.
  // recurring 가입 경로(subscribeWithBillingMethod, 결제수단 필요)가 개통되면 그 경로로 재작성한다.
  describe.skip('Task 8: 무료 체험 악용 방지 (recurring 경로 개통 후 재작성)', () => {
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
      await cancellationService.cancelSubscription(newUserId, 'test@example.com', { reasonCode: 'TRIAL_PERIOD', reasonText: '체험 후 결정' });

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
      await cancellationService.cancelSubscription(newUserId, 'test@example.com', { reasonCode: 'TRIAL_PERIOD' });

      // 2차: 재구독 → 취소
      await subscriptionService.createSubscription(newUserId, testPlanId);
      await cancellationService.cancelSubscription(newUserId, 'test@example.com', { reasonCode: 'TRIAL_PERIOD' });

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
