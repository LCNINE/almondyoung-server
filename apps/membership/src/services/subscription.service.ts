import { HttpStatus, Injectable } from '@nestjs/common';
import {
  SubscriptionNotFoundException,
  ActiveSubscriptionExistsException,
  PlanNotFoundException,
  SubscriptionException,
} from '../shared/exceptions/subscription.exceptions';
import * as schema from '../shared/schemas/entities/schema';
import { membershipSchema } from '../shared/schemas/entities/schema';
import { DbService } from '@app/db';
import { eq, desc, and } from 'drizzle-orm';
import { addDays } from 'date-fns';
import { PlanService } from './plan.service';
import { EntitlementService } from './entitlement.service';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly planService: PlanService,
    private readonly entitlementService: EntitlementService,
  ) {}

  /**
   * 사용자의 현재 구독 및 권한 상세 정보를 조회합니다.
   * @param userId - 사용자 ID
   */
  async getCurrentSubscriptionDetails(userId: string) {
    return this.entitlementService.getUserEntitlement(userId);
  }

  /**
   * 새로운 구독을 생성합니다.
   * 구독 계약(Contract)과 권한(Entitlement)을 함께 생성하고, 이를 발생시킨 이벤트 배치를 기록합니다.
   * @param userId - 사용자 ID
   * @param planId - 구독할 플랜 ID
   */
  async createSubscription(userId: string, planId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      const existingEntitlement =
        await this.entitlementService.getUserEntitlement(userId);
      if (existingEntitlement) {
        throw new ActiveSubscriptionExistsException();
      }

      const plan = await this.planService.getPlanDetails(planId);
      if (!plan) {
        throw new PlanNotFoundException();
      }

      const now = new Date();
      const startsAt = now;
      const endsAt = addDays(
        startsAt,
        plan.plan.durationDays + (plan.plan.trialDays || 0),
      );
      const billingDate = addDays(startsAt, plan.plan.trialDays || 0); // 첫 결제일
      const nextBillingDate = addDays(billingDate, plan.plan.durationDays); // 다음 결제일

      // 1. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_CREATED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 구독 계약 생성
      const [contract] = await tx
        .insert(schema.subscriptionContracts)
        .values({
          userId,
          planId,
          billingDate: billingDate.toISOString().split('T')[0], // 첫 결제일 저장
          nextBillingDate: nextBillingDate.toISOString().split('T')[0],
        })
        .returning();

      // 3. EntitlementService를 통해 구독 권한 생성
      const entitlement = await this.entitlementService.createEntitlement(
        tx,
        userId,
        plan.tier.id,
        startsAt,
        endsAt,
        batch.id,
      );

      return {
        contractId: contract.id,
        entitlementId: entitlement.id,
      };
    });
  }

  /**
   * 구독을 즉시 업그레이드합니다.
   * 기존 권한은 종료되고, 새로운 플랜으로 즉시 새로운 권한이 시작됩니다.
   * @param userId - 사용자 ID
   * @param newPlanId - 업그레이드할 새 플랜 ID
   */
  async upgradeSubscription(userId: string, newPlanId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      const current = await this.entitlementService.getUserEntitlement(userId);
      if (!current) {
        throw new SubscriptionNotFoundException();
      }

      const newPlan = await this.planService.getPlanDetails(newPlanId);
      if (!newPlan) {
        throw new PlanNotFoundException();
      }

      // 랭크 비교로 업그레이드 여부 확인
      if (newPlan.tier.priorityLevel <= current.tier.priorityLevel) {
        throw new SubscriptionException(
          '새 플랜이 현재 플랜보다 등급이 높지 않습니다.',
          'INVALID_PLAN_CHANGE',
          HttpStatus.BAD_REQUEST,
        );
      }

      const now = new Date();
      // TODO: 남은 기간에 대한 크레딧 계산 로직 추가 가능
      // 여기서는 즉시 새 플랜의 전체 기간으로 갱신하는 것으로 가정
      const newEndsAt = addDays(now, newPlan.plan.durationDays);

      // 1. 업그레이드 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_UPGRADED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 기존 계약의 플랜을 새 플랜으로 업데이트
      await tx
        .update(schema.subscriptionContracts)
        .set({ planId: newPlanId })
        .where(eq(schema.subscriptionContracts.id, current.contract.id));

      // 3. EntitlementService를 통해 새 권한 생성 (기존 권한은 내부적으로 종료됨)
      const newEntitlement = await this.entitlementService.createEntitlement(
        tx,
        userId,
        newPlan.tier.id,
        now,
        newEndsAt,
        batch.id,
      );

      return {
        newEntitlementId: newEntitlement.id,
        effectiveDate: now,
      };
    });
  }

  /**
   * 구독을 취소합니다.
   * 계약을 무효화하고 현재 권한을 종료 상태로 변경합니다.
   * @param userId - 사용자 ID
   * @param reason - 취소 사유 (선택)
   */
  async cancelSubscription(userId: string, reason?: string) {
    return await this.dbService.db.transaction(async (tx) => {
      const current = await this.entitlementService.getUserEntitlement(userId);
      if (!current) {
        throw new SubscriptionNotFoundException();
      }

      const now = new Date();

      // 1. 취소 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_CANCELLED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 계약 무효화
      await tx
        .update(schema.subscriptionContracts)
        .set({
          isVoided: true,
          voidedAt: now,
          reason,
        })
        .where(eq(schema.subscriptionContracts.id, current.contract.id));

      // 3. 현재 권한 종료 (EntitlementService에 위임)
      // terminateActiveEntitlement는 private이므로, 공개 메소드를 만들어 호출하거나
      // 아래와 같이 직접 종료 로직을 수행할 수 있습니다.
      // 여기서는 EntitlementService의 내부 로직을 직접 호출하는 대신,
      // SubscriptionService의 책임 하에 직접 종료합니다.
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: now,
          closedBatchId: batch.id,
        })
        .where(eq(schema.subscriptionEntitlement.id, current.entitlement.id));

      return {
        cancelledAt: now,
        contractId: current.contract.id,
      };
    });
  }

  /**
   * 사용자의 구독 계약 이력을 조회합니다.
   * @param userId - 사용자 ID
   */
  async getSubscriptionHistory(userId: string) {
    const history = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.subscriptionContracts.createdAt));

    return history;
  }

  /**
   * 사용자의 활성 구독 정보를 조회합니다.
   * @param userId - 사용자 ID
   * @returns 활성 구독이 있으면 구독 정보, 없으면 null
   */
  async getActiveSubscription(userId: string) {
    const contracts = await this.dbService.db
      .select({
        contract: schema.subscriptionContracts,
        plan: schema.plan,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(
        schema.plan,
        eq(schema.subscriptionContracts.planId, schema.plan.id),
      )
      .where(
        and(
          eq(schema.subscriptionContracts.userId, userId),
          eq(schema.subscriptionContracts.isVoided, false),
        ),
      )
      .limit(1);

    if (!contracts.length) {
      return null;
    }

    const { contract, plan } = contracts[0];

    // durationDays로 구독 타입 판단 (30일 = MONTHLY, 365일 = ANNUAL)
    const subscriptionType = plan.durationDays === 30 ? 'MONTHLY' : 'ANNUAL';

    return {
      id: contract.id,
      userId: contract.userId,
      billingDate: new Date(contract.billingDate), // 30일 주기 계산에 사용
      type: subscriptionType as 'MONTHLY' | 'ANNUAL',
    };
  }
}
