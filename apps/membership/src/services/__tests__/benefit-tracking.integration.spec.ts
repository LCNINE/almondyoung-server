import { Test, TestingModule } from '@nestjs/testing';
import { BenefitTrackingService } from '../benefit-tracking.service';
import { SubscriptionService } from '../subscription.service';
import { PlanService } from '../plan.service';
import { EntitlementService } from '../entitlement.service';
import { DbModule, DbService } from '@app/db';
import {
  membershipSchema,
  type MembershipSchema,
} from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq } from 'drizzle-orm';

/**
 * 멤버십 혜택 추적 통합 테스트
 *
 * 테스트 시나리오:
 * 1. 주문 완료 → 혜택 기록 → 조회
 * 2. 중복 주문 → 멱등성 확인
 * 3. 주문 취소 → 혜택 차감 확인
 */
describe('BenefitTrackingService (Integration)', () => {
  let service: BenefitTrackingService;
  let subscriptionService: SubscriptionService;
  let planService: PlanService;
  let dbService: DbService<MembershipSchema>;
  let module: TestingModule;

  // 테스트 데이터 ID 저장용
  let testTierId: string;
  let testPlanId: string;
  let testUserId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.DATABASE_URL ||
              'postgresql://neondb_owner:npg_VR7yj1uOfPTs@ep-divine-hill-a1nspuc3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: membershipSchema,
        }),
      ],
      providers: [
        BenefitTrackingService,
        SubscriptionService,
        PlanService,
        EntitlementService,
      ],
    }).compile();

    service = module.get<BenefitTrackingService>(BenefitTrackingService);
    subscriptionService = module.get<SubscriptionService>(SubscriptionService);
    planService = module.get<PlanService>(PlanService);
    dbService = module.get<DbService<MembershipSchema>>(DbService);
  });

  beforeEach(async () => {
    // 각 테스트 전 DB 청소
    await cleanupDatabase();
    // 테스트 데이터 생성
    await setupTestData();
  });

  afterEach(async () => {
    // 각 테스트 후 DB 청소
    await cleanupDatabase();
  });

  afterAll(async () => {
    await module.close();
  });

  describe('전체 플로우: 기록 → 조회 → 취소', () => {
    it('1. 주문 완료 시 혜택을 기록할 수 있어야 한다', async () => {
      const orderId = 'test-order-001';
      const dto = {
        orderId,
        userId: testUserId,
        orderDate: new Date('2025-10-28').toISOString(),
        membershipDiscountAmount: 5000,
        tierId: testTierId,
      };

      // 혜택 기록
      await service.recordDiscount(dto);

      // DB에 실제로 저장되었는지 확인
      const events = await dbService.db
        .select()
        .from(schema.membershipDiscountEvents)
        .where(eq(schema.membershipDiscountEvents.orderId, orderId));

      expect(events).toHaveLength(1);
      expect(events[0].userId).toBe(testUserId);
      expect(events[0].discountAmount).toBe(5000);
      expect(events[0].isCancelled).toBe(false);
    });

    it('2. 같은 주문을 중복 처리하면 멱등성이 보장되어야 한다', async () => {
      const orderId = 'test-order-002';
      const dto = {
        orderId,
        userId: testUserId,
        orderDate: new Date('2025-10-28').toISOString(),
        membershipDiscountAmount: 5000,
        tierId: testTierId,
      };

      // 첫 번째 기록
      await service.recordDiscount(dto);

      // 두 번째 기록 (동일한 orderId) - 에러 없이 성공해야 함
      await service.recordDiscount(dto);

      // DB에는 여전히 1개만 있어야 함
      const events = await dbService.db
        .select()
        .from(schema.membershipDiscountEvents)
        .where(eq(schema.membershipDiscountEvents.orderId, orderId));

      expect(events).toHaveLength(1);
    });

    it('3. 현재 주기 혜택을 조회할 수 있어야 한다', async () => {
      // 먼저 혜택 기록
      const orderId = 'test-order-003';
      await service.recordDiscount({
        orderId,
        userId: testUserId,
        orderDate: new Date().toISOString(),
        membershipDiscountAmount: 5000,
        tierId: testTierId,
      });

      // 현재 주기 조회
      const result = await service.getCurrentCycleBenefit(testUserId);

      expect(result).toBeDefined();
      expect(result.userId).toBe(testUserId);
      expect(result.cycleStartDate).toBeDefined();
      expect(result.cycleEndDate).toBeDefined();
      expect(result.totalDiscountAmount).toBeGreaterThanOrEqual(5000);
      expect(result.orderCount).toBeGreaterThanOrEqual(1);
    });

    it('4. 주문 취소 시 혜택이 차감되어야 한다', async () => {
      const orderId = 'test-order-004';

      // 혜택 기록
      await service.recordDiscount({
        orderId,
        userId: testUserId,
        orderDate: new Date().toISOString(),
        membershipDiscountAmount: 5000,
        tierId: testTierId,
      });

      // 취소 전 금액 확인
      const beforeCancel = await service.getCurrentCycleBenefit(testUserId);
      const amountBefore = beforeCancel.totalDiscountAmount;

      // 주문 취소
      await service.cancelDiscount(orderId);

      // 취소 후 금액 확인
      const afterCancel = await service.getCurrentCycleBenefit(testUserId);
      expect(afterCancel.totalDiscountAmount).toBeLessThan(amountBefore);
    });
  });

  describe('엣지 케이스', () => {
    it('활성 구독이 없는 경우 에러를 반환하지 않아야 한다 (로그만 기록)', async () => {
      const dto = {
        orderId: 'test-order-no-sub',
        userId: 'user-no-subscription',
        orderDate: new Date().toISOString(),
        membershipDiscountAmount: 5000,
        tierId: testTierId,
      };

      // 구독이 없어도 에러가 발생하지 않아야 함 (단순 return)
      await service.recordDiscount(dto);

      // DB에 기록되지 않았는지 확인
      const events = await dbService.db
        .select()
        .from(schema.membershipDiscountEvents)
        .where(
          eq(schema.membershipDiscountEvents.orderId, 'test-order-no-sub'),
        );

      expect(events).toHaveLength(0);
    });

    it('존재하지 않는 orderId를 취소하면 에러를 던져야 한다', async () => {
      const nonExistentOrderId = 'non-existent-order';

      // DB에 없는 주문 취소 시 에러
      await expect(
        service.cancelDiscount(nonExistentOrderId),
      ).rejects.toThrow();
    });

    it('이미 취소된 주문을 다시 취소하면 멱등성이 보장되어야 한다', async () => {
      const orderId = 'test-order-cancel-twice';

      // 먼저 혜택 기록
      await service.recordDiscount({
        orderId,
        userId: testUserId,
        orderDate: new Date().toISOString(),
        membershipDiscountAmount: 5000,
        tierId: testTierId,
      });

      // 첫 번째 취소
      await service.cancelDiscount(orderId);

      // 두 번째 취소 - 에러 없이 성공해야 함
      await service.cancelDiscount(orderId);

      // 여전히 취소 상태여야 함
      const events = await dbService.db
        .select()
        .from(schema.membershipDiscountEvents)
        .where(eq(schema.membershipDiscountEvents.orderId, orderId));

      expect(events[0].isCancelled).toBe(true);
    });
  });

  describe('주기 계산 로직 검증', () => {
    it('주기 경계 날짜(29일 → 30일)에서 주기가 올바르게 계산되어야 한다', async () => {
      // billingDate가 2025-10-15인 구독이 이미 생성되어 있음

      // Cycle 1의 마지막 날 (10/15 + 29일 = 11/13)
      await service.recordDiscount({
        orderId: 'order-day-29',
        userId: testUserId,
        orderDate: new Date('2025-11-13').toISOString(),
        membershipDiscountAmount: 1000,
        tierId: testTierId,
      });

      // Cycle 2의 첫 날 (11/14)
      await service.recordDiscount({
        orderId: 'order-day-30',
        userId: testUserId,
        orderDate: new Date('2025-11-14').toISOString(),
        membershipDiscountAmount: 1000,
        tierId: testTierId,
      });

      // 두 주문이 서로 다른 주기에 기록되었는지 확인
      const allBenefits = await dbService.db
        .select()
        .from(schema.membershipCycleBenefits)
        .where(eq(schema.membershipCycleBenefits.userId, testUserId));

      // 최소 2개의 서로 다른 주기가 있어야 함
      expect(allBenefits.length).toBeGreaterThanOrEqual(2);
    });
  });

  // 🧹 청소 함수 - 관계 순서 중요!
  async function cleanupDatabase() {
    try {
      // 외래키 제약 때문에 자식부터 삭제
      await dbService.db.delete(schema.membershipCycleBenefits);
      await dbService.db.delete(schema.membershipDiscountEvents);
      await dbService.db.delete(schema.subscriptionEntitlement);
      await dbService.db.delete(schema.subscriptionContracts);
      await dbService.db.delete(schema.plan);
      await dbService.db.delete(schema.tiers);
    } catch (error) {
      console.warn('청소 중 에러 발생 (테스트는 계속):', error);
    }
  }

  // 테스트 데이터 생성
  async function setupTestData() {
    // 1. Tier 생성
    const [tier] = await dbService.db
      .insert(schema.tiers)
      .values({
        code: 'TEST_PREMIUM',
        priorityLevel: 100,
      })
      .returning();
    testTierId = tier.id;

    // 2. Plan 생성
    const [plan] = await dbService.db
      .insert(schema.plan)
      .values({
        tierId: testTierId,
        price: 100000,
        durationDays: 365,
        trialDays: 3,
        currency: 'KRW',
        isActive: true,
      })
      .returning();
    testPlanId = plan.id;

    // 3. 테스트 사용자 ID 설정
    testUserId = 'test-user-' + Date.now();

    // 4. 구독 계약 생성 (billingDate = 2025-10-15)
    await dbService.db.insert(schema.subscriptionContracts).values({
      userId: testUserId,
      planId: testPlanId,
      billingDate: '2025-10-15',
      nextBillingDate: '2026-10-15',
      leadDays: 0,
      isVoided: false,
    });

    // 5. 권한 생성
    await dbService.db.insert(schema.subscriptionEntitlement).values({
      userId: testUserId,
      tierId: testTierId,
      startsAt: '2025-10-15',
      endsAt: '2026-10-15',
      isCurrent: true,
    });
  }
});
