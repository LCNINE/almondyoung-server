import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { SubscriptionCancellationService } from '../../src/services/subscription-cancellation.service';
import { ContractEventService } from '../../src/services/contract-event.service';
import { CancellationReasonService } from '../../src/services/cancellation-reason.service';
import { RefundEventHandler } from '../../src/services/refund-event-handler.service';
import {
  membershipSchema,
  type MembershipSchema,
} from '../../src/shared/schemas/entities/schema';
import * as schema from '../../src/shared/schemas/entities/schema';
import { eq } from 'drizzle-orm';
import { addDays } from 'date-fns';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .env 파일 로드
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

describe('Subscription Cancellation Integration Tests', () => {
  let cancellationService: SubscriptionCancellationService;
  let contractEventService: ContractEventService;
  let cancellationReasonService: CancellationReasonService;
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
        ContractEventService,
        CancellationReasonService,
        RefundEventHandler,
      ],
    }).compile();

    cancellationService = module.get<SubscriptionCancellationService>(
      SubscriptionCancellationService,
    );
    contractEventService =
      module.get<ContractEventService>(ContractEventService);
    cancellationReasonService = module.get<CancellationReasonService>(
      CancellationReasonService,
    );
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
      const reasons = await cancellationReasonService.getActiveReasons();

      expect(reasons).toHaveLength(2);
      expect(reasons[0].code).toBe('TRIAL_PERIOD');
      expect(reasons[1].code).toBe('PRICE_TOO_HIGH');
    });

    it('✅ 취소 이유 코드로 조회', async () => {
      const reason =
        await cancellationReasonService.getReasonByCode('TRIAL_PERIOD');

      expect(reason).toBeDefined();
      expect(reason?.displayText).toBe('더 나은 서비스를 위해 노력하겠습니다');
    });

    it('✅ 계약 이벤트 조회', async () => {
      // 이벤트 추가
      await dbService.db.transaction(async (tx) => {
        await contractEventService.addEvent(
          tx,
          testContractId,
          'CREATED',
          { planId: testPlanId },
          'USER',
          testUserId,
        );
      });

      const events =
        await contractEventService.getContractEvents(testContractId);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('CREATED');
    });
  });

  describe('Task 3: 일반 구독 취소 (무료 체험 기간 중)', () => {
    it('✅ 무료 체험 기간 중 취소 - 전액 환불', async () => {
      const result = await cancellationService.cancelSubscription(
        testUserId,
        'TRIAL_PERIOD',
        '체험 기간 중 취소',
      );

      expect(result.status).toBe('CANCELLED');
      expect(result.refundEligible).toBe(true);
      expect(result.refundAmount).toBe(9900);
      expect(result.refundStatus).toBe('PENDING');

      // DB 상태 확인
      const [contract] = await dbService.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, testContractId));

      expect(contract.status).toBe('CANCELLED');
      expect(contract.refundRequested).toBe(true);
      expect(contract.eligibleRefundAmount).toBe(9900);

      // 이벤트 확인
      const events =
        await contractEventService.getContractEvents(testContractId);
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

      const result = await cancellationService.cancelSubscription(
        testUserId,
        'PRICE_TOO_HIGH',
      );

      expect(result.status).toBe('CANCELLED');
      expect(result.refundEligible).toBe(false);
      expect(result.refundAmount).toBe(0);
      expect(result.refundStatus).toBe('NOT_APPLICABLE');
    });

    it('❌ 중복 취소 시도 - 에러', async () => {
      // 첫 번째 취소
      await cancellationService.cancelSubscription(testUserId, 'TRIAL_PERIOD');

      // 두 번째 취소 시도
      await expect(
        cancellationService.cancelSubscription(testUserId, 'TRIAL_PERIOD'),
      ).rejects.toThrow('Contract already cancelled');
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
      const events =
        await contractEventService.getContractEvents(testContractId);
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
      const events =
        await contractEventService.getContractEvents(testContractId);
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
      const events =
        await contractEventService.getContractEvents(testContractId);
      const refundCompletedEvents = events.filter(
        (e) => e.eventType === 'REFUND_COMPLETED',
      );
      expect(refundCompletedEvents).toHaveLength(1);
    });

    it('✅ 환불 실패 이벤트 처리', async () => {
      await refundEventHandler.handleRefundFailed({
        contractId: testContractId,
        userId: testUserId,
        errorMessage: 'Insufficient balance',
      });

      // 이벤트 확인
      const events =
        await contractEventService.getContractEvents(testContractId);
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
      const events =
        await contractEventService.getContractEvents(testContractId);

      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events.some((e) => e.eventType === 'CANCELLED')).toBe(true);
      expect(events.some((e) => e.eventType === 'REFUND_REQUESTED')).toBe(true);
      expect(events.some((e) => e.eventType === 'REFUND_COMPLETED')).toBe(true);

      // 시간 순서 확인
      const sortedEvents = events.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      expect(sortedEvents[0].eventType).toBe('CANCELLED');
    });
  });
});
