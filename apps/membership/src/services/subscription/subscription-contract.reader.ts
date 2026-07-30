import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, desc, inArray, count } from 'drizzle-orm';

type Contract = typeof schema.subscriptionContracts.$inferSelect;
type Plan = typeof schema.plan.$inferSelect;

@Injectable()
export class SubscriptionContractReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 활성 계약 조회
   */
  async findActiveContract(userId: string): Promise<Contract | null> {
    // ACTIVE 계약이 복수인 창(재가입)에서 임의 선택 방지 — 최신 1건
    const [contract] = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(and(eq(schema.subscriptionContracts.userId, userId), eq(schema.subscriptionContracts.status, 'ACTIVE')))
      .orderBy(desc(schema.subscriptionContracts.createdAt), desc(schema.subscriptionContracts.id))
      .limit(1);

    return contract || null;
  }

  /**
   * 결제 Intent ID로 계약 조회 (환불 회수 경로용 — status 무관, 최신 1건)
   */
  async findByPaymentIntentId(intentId: string): Promise<Contract | null> {
    const [contract] = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.lastPaymentIntentId, intentId))
      .orderBy(desc(schema.subscriptionContracts.createdAt))
      .limit(1);

    return contract || null;
  }

  /**
   * 계약 ID로 조회
   */
  async findById(contractId: string): Promise<Contract | null> {
    const [contract] = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, contractId))
      .limit(1);

    return contract || null;
  }

  /**
   * 플랜 조회
   */
  async findPlan(planId: string): Promise<Plan | null> {
    const [plan] = await this.dbService.db.select().from(schema.plan).where(eq(schema.plan.id, planId)).limit(1);

    return plan || null;
  }

  /**
   * 계약과 플랜 함께 조회
   */
  async findContractWithPlan(userId: string): Promise<{ contract: Contract; plan: Plan } | null> {
    const contract = await this.findActiveContract(userId);
    if (!contract) return null;

    const plan = await this.findPlan(contract.planId);
    if (!plan) return null;

    return { contract, plan };
  }

  /**
   * 현재 활성 권한 조회 (해지 시 이용 종료일 판단용)
   */
  async findCurrentEntitlement(userId: string): Promise<{ id: string; endsAt: string; startsAt: string } | null> {
    const [entitlement] = await this.dbService.db
      .select({
        id: schema.subscriptionEntitlement.id,
        endsAt: schema.subscriptionEntitlement.endsAt,
        startsAt: schema.subscriptionEntitlement.startsAt,
      })
      .from(schema.subscriptionEntitlement)
      .where(
        and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
      )
      .limit(1);

    return entitlement || null;
  }

  /**
   * 동일 티어의 활성 월간 플랜 정가.
   *
   * 연간 중도해지 정산의 기준값이다. 연간가는 '월간 정가 × 12 − 2개월' 로 만들어졌으므로,
   * 월간 플랜이 없거나 비활성이면 연간가/10 을 같은 뜻의 폴백으로 쓴다.
   */
  async findMonthlyListPrice(tierId: string, annualPrice: number): Promise<number> {
    const [monthly] = await this.dbService.db
      .select({ price: schema.plan.price })
      .from(schema.plan)
      .where(and(eq(schema.plan.tierId, tierId), eq(schema.plan.durationDays, 30), eq(schema.plan.isActive, true)))
      .orderBy(desc(schema.plan.createdAt))
      .limit(1);

    return monthly?.price ?? Math.round(annualPrice / 10);
  }

  /**
   * 사용자의 모든 계약 이력 조회
   */
  async findContractsByUserId(userId: string): Promise<Contract[]> {
    return await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.subscriptionContracts.createdAt));
  }

  /**
   * 사용자의 모든 계약 이력 + 플랜/티어 정보 함께 조회
   */
  async findContractsByUserIdWithPlan(userId: string) {
    return await this.dbService.db
      .select({
        contract: schema.subscriptionContracts,
        plan: schema.plan,
        tier: schema.tiers,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .leftJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.subscriptionContracts.createdAt));
  }

  /**
   * 멤버십 기록조회
   */
  async findContractsByUserIdWithPlanPaged(userId: string, limit: number, offset: number) {
    return await this.dbService.db
      .select({
        contract: schema.subscriptionContracts,
        plan: schema.plan,
        tier: schema.tiers,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .leftJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.subscriptionContracts.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * 사용자의 전체 계약 이력 건수 조회
   */
  async countContractsByUserId(userId: string): Promise<number> {
    const [row] = await this.dbService.db
      .select({ value: count() })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId));

    return row?.value ?? 0;
  }

  /**
   * 사용자의 구독 기간 조정 이벤트 조회 (ENTITLEMENT_EXTENDED / ENTITLEMENT_REDUCED)
   */
  async findAdjustmentEventsByUserId(userId: string) {
    return await this.dbService.db
      .select()
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.userId, userId),
          inArray(schema.subscriptionContractEvents.eventType, [
            'ENTITLEMENT_EXTENDED',
            'ENTITLEMENT_REDUCED',
            'GRANTED_BY_ADMIN',
          ]),
        ),
      )
      .orderBy(desc(schema.subscriptionContractEvents.createdAt));
  }
}
