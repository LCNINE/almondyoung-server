// ============================================
// features/subscription/subscription.service.ts
// ============================================

import { Injectable } from '@nestjs/common';
import {
  SubscriptionNotFoundException,
  ActiveSubscriptionExistsException,
  PlanNotFoundException,
  SubscriptionPausedException,
  InvalidPlanChangeException,
  PolicyViolationException,
} from '../shared/exceptions/subscription.exceptions';

import * as schema from '../shared/schemas/entities/schema';
import { DbService } from '@app/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import { EventPublisherService } from '@app/events';
import { PolicyEngineService } from '../policy-management/policy-engine.service';
import { v4 as uuidv4 } from 'uuid';
import { addDays, differenceInDays } from 'date-fns';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly dbService: DbService<typeof schema>,
    // TODO: Uncomment when event publishing is implemented
    // private readonly eventPublisher: EventPublisherService,
    private readonly policyEngine: PolicyEngineService,
  ) {}

  /**
   * 현재 활성 구독 조회
   */
  async getCurrentSubscription(userId: string) {
    const result = await this.dbService.db
      .select({
        subscription: schema.subscriptions,
        plan: schema.subscriptionPlans,
        tier: schema.subscriptionTiers,
        activeRight: schema.subscriptionRights,
      })
      .from(schema.subscriptions)
      .innerJoin(
        schema.subscriptionPlans,
        eq(schema.subscriptions.planId, schema.subscriptionPlans.id),
      )
      .innerJoin(
        schema.subscriptionTiers,
        eq(schema.subscriptionPlans.tierId, schema.subscriptionTiers.id),
      )
      .leftJoin(
        schema.subscriptionRights,
        and(
          eq(schema.subscriptionRights.subscriptionId, schema.subscriptions.id),
          eq(schema.subscriptionRights.isActive, true),
          lte(schema.subscriptionRights.startsAt, new Date().toISOString()),
          gte(schema.subscriptionRights.endsAt, new Date().toISOString()),
        ),
      )
      .where(
        and(
          eq(schema.subscriptions.userId, userId),
          eq(schema.subscriptions.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    if (!result.length) {
      return null;
    }

    const { subscription, plan, tier, activeRight } = result[0];

    // 일시정지 상태 확인
    const isPaused = activeRight?.pausedAt !== null;

    return {
      id: subscription.id,
      status: isPaused ? 'PAUSED' : subscription.status,
      currentTier: {
        id: tier.id,
        code: tier.code,
        name: tier.name,
        priorityLevel: tier.priorityLevel,
      },
      plan: {
        id: plan.id,
        price: plan.price,
        durationDays: plan.durationDays,
        currency: plan.currency,
      },
      nextBillingDate: subscription.nextBillingDate,
      startsAt: activeRight?.startsAt,
      endsAt: activeRight?.endsAt,
      isPaused,
      pausedAt: activeRight?.pausedAt,
    };
  }

  /**
   * 새 구독 생성
   */
  async createSubscription(userId: string, planId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 기존 활성 구독 확인
      const existingSubscription = await this.getCurrentSubscription(userId);
      if (existingSubscription) {
        throw new ActiveSubscriptionExistsException();
      }

      // 2. 플랜 정보 조회
      const plan = await tx
        .select()
        .from(schema.subscriptionPlans)
        .where(
          and(
            eq(schema.subscriptionPlans.id, planId),
            eq(schema.subscriptionPlans.isActive, true),
          ),
        )
        .limit(1);

      if (!plan.length) {
        throw new PlanNotFoundException();
      }

      const selectedPlan = plan[0];
      const subscriptionId = uuidv4();
      const now = new Date();
      const startDate = now;
      const billingStartDate = selectedPlan.trialDays
        ? addDays(now, selectedPlan.trialDays)
        : now;

      // 3. 구독 생성
      await tx.insert(schema.subscriptions).values({
        id: subscriptionId,
        userId,
        planId,
        status: 'ACTIVE',
        startedAt: startDate.toISOString().split('T')[0],
        nextBillingDate: billingStartDate.toISOString().split('T')[0],
        changeType: 'INITIAL',
        adjustmentAmount: 0,
      });

      // 4. 구독 권리 생성
      const rightId = uuidv4();
      const endDate = addDays(startDate, selectedPlan.durationDays);

      await tx.insert(schema.subscriptionRights).values({
        id: rightId,
        userId,
        tierId: selectedPlan.tierId,
        subscriptionId,
        startsAt: startDate.toISOString().split('T')[0],
        endsAt: endDate.toISOString().split('T')[0],
        isActive: true,
      });

      // 5. 이벤트 생성 (카프카는 나중에 구현)
      const eventId = uuidv4();
      await tx.insert(schema.subscriptionEvents).values({
        id: eventId,
        eventType: 'CREATE',
        userId,
        subscriptionId,
        effectiveDate: startDate.toISOString().split('T')[0],
        eventPayload: {
          planId,
          tierId: selectedPlan.tierId,
          trialDays: selectedPlan.trialDays || 0,
        },
      });

      return { subscriptionId, rightId };
    });
  }

  /**
   * 구독 업그레이드
   */
  async upgradeSubscription(userId: string, newPlanId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 현재 구독 조회
      const currentSub = await this.getCurrentSubscription(userId);
      if (!currentSub) {
        throw new SubscriptionNotFoundException();
      }

      if (currentSub.isPaused) {
        throw new SubscriptionPausedException('플랜 변경');
      }

      // 2. 새 플랜 정보 조회
      const newPlan = await tx
        .select({
          plan: schema.subscriptionPlans,
          tier: schema.subscriptionTiers,
        })
        .from(schema.subscriptionPlans)
        .innerJoin(
          schema.subscriptionTiers,
          eq(schema.subscriptionPlans.tierId, schema.subscriptionTiers.id),
        )
        .where(eq(schema.subscriptionPlans.id, newPlanId))
        .limit(1);

      if (!newPlan.length) {
        throw new PlanNotFoundException();
      }

      const { plan: newPlanData, tier: newTier } = newPlan[0];

      // 3. 우선순위 검증 (업그레이드인지 확인)
      if (newTier.priorityLevel <= currentSub.currentTier.priorityLevel) {
        throw new InvalidPlanChangeException(
          '업그레이드가 아닙니다. 다운그레이드는 별도 API를 사용하세요.',
        );
      }

      // 4. 정책 검증
      try {
        const policyResult = await this.policyEngine.validateRequest(
          userId,
          'PLAN_CHANGE',
          {
            currentPlanId: currentSub.plan.id,
            newPlanId,
            changeType: 'UPGRADE',
            currentTierPriority: currentSub.currentTier.priorityLevel,
            newTierPriority: newTier.priorityLevel,
          }
        );

        if (!policyResult.isValid) {
          const violations = policyResult.violatedPolicies.map(v => v.message).join(', ');
          throw new PolicyViolationException('UPGRADE_POLICY_VIOLATION', violations);
        }
      } catch (error) {
        if (error instanceof PolicyViolationException) {
          throw error;
        }
        // 정책 엔진 오류 시 계속 진행 (폴백)
      }

      // 4. 정산 금액 계산
      const remainingDays = differenceInDays(currentSub.endsAt!, new Date());
      const currentDailyRate =
        currentSub.plan.price / currentSub.plan.durationDays;
      const newDailyRate = newPlanData.price / newPlanData.durationDays;
      const adjustmentAmount = Math.ceil(
        (newDailyRate - currentDailyRate) * remainingDays,
      );

      // 5. 기존 권리 종료
      await tx
        .update(schema.subscriptionRights)
        .set({
          isActive: false,
          closedAt: new Date(),
          closedByEventId: uuidv4(), // 추후 이벤트 ID로 업데이트
        })
        .where(
          and(
            eq(schema.subscriptionRights.userId, userId),
            eq(schema.subscriptionRights.isActive, true),
          ),
        );

      // 6. 새 구독 생성
      const newSubscriptionId = uuidv4();
      await tx.insert(schema.subscriptions).values({
        id: newSubscriptionId,
        userId,
        planId: newPlanId,
        status: 'ACTIVE',
        startedAt: new Date().toISOString().split('T')[0],
        nextBillingDate: currentSub.nextBillingDate, // 기존 결제일 유지
        previousSubscriptionId: currentSub.id,
        changeType: 'UPGRADE',
        adjustmentAmount,
      });

      // 7. 새 권리 생성
      const newRightId = uuidv4();
      await tx.insert(schema.subscriptionRights).values({
        id: newRightId,
        userId,
        tierId: newTier.id,
        subscriptionId: newSubscriptionId,
        startsAt: new Date().toISOString().split('T')[0],
        endsAt: currentSub.endsAt!, // 기존 종료일 유지
        isActive: true,
      });

      // 8. 이벤트 생성 (카프카는 나중에 구현)
      const eventId = uuidv4();
      await tx.insert(schema.subscriptionEvents).values({
        id: eventId,
        eventType: 'UPGRADE',
        userId,
        subscriptionId: newSubscriptionId,
        effectiveDate: new Date().toISOString().split('T')[0],
        eventPayload: {
          fromPlanId: currentSub.plan.id,
          toPlanId: newPlanId,
          adjustmentAmount,
          remainingDays,
        },
      });

      return {
        newSubscriptionId,
        adjustmentAmount,
        effectiveDate: new Date(),
      };
    });
  }

  /**
   * 구독 다운그레이드 (다음 결제 주기에 적용)
   */
  async downgradeSubscription(userId: string, newPlanId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 현재 구독 조회
      const currentSub = await this.getCurrentSubscription(userId);
      if (!currentSub) {
        throw new SubscriptionNotFoundException();
      }

      // 2. 새 플랜 검증
      const newPlan = await tx
        .select({
          plan: schema.subscriptionPlans,
          tier: schema.subscriptionTiers,
        })
        .from(schema.subscriptionPlans)
        .innerJoin(
          schema.subscriptionTiers,
          eq(schema.subscriptionPlans.tierId, schema.subscriptionTiers.id),
        )
        .where(eq(schema.subscriptionPlans.id, newPlanId))
        .limit(1);

      if (
        !newPlan.length ||
        newPlan[0].tier.priorityLevel >= currentSub.currentTier.priorityLevel
      ) {
        throw new InvalidPlanChangeException('유효한 다운그레이드가 아닙니다.');
      }

      // 3. 정책 검증
      try {
        const policyResult = await this.policyEngine.validateRequest(
          userId,
          'PLAN_CHANGE',
          {
            currentPlanId: currentSub.plan.id,
            newPlanId,
            changeType: 'DOWNGRADE',
            currentTierPriority: currentSub.currentTier.priorityLevel,
            newTierPriority: newPlan[0].tier.priorityLevel,
          }
        );

        if (!policyResult.isValid) {
          const violations = policyResult.violatedPolicies.map(v => v.message).join(', ');
          throw new PolicyViolationException('DOWNGRADE_POLICY_VIOLATION', violations);
        }
      } catch (error) {
        if (error instanceof PolicyViolationException) {
          throw error;
        }
        // 정책 엔진 오류 시 계속 진행 (폴백)
      }

      // 4. 다운그레이드 예약 이벤트 생성
      const eventId = uuidv4();
      const effectiveDate =
        currentSub.nextBillingDate || new Date().toISOString().split('T')[0];

      await tx.insert(schema.subscriptionEvents).values({
        id: eventId,
        eventType: 'DOWNGRADE_SCHEDULED',
        userId,
        subscriptionId: currentSub.id,
        effectiveDate,
        eventPayload: {
          currentPlanId: currentSub.plan.id,
          scheduledPlanId: newPlanId,
          effectiveDate,
        },
      });

      // 카프카 이벤트는 나중에 구현

      return {
        scheduledDate: currentSub.nextBillingDate,
        currentPlan: currentSub.plan,
        scheduledPlan: newPlan[0].plan,
      };
    });
  }

  /**
   * 구독 취소
   */
  async cancelSubscription(userId: string, reason?: string) {
    return await this.dbService.db.transaction(async (tx) => {
      const currentSub = await this.getCurrentSubscription(userId);
      if (!currentSub) {
        throw new SubscriptionNotFoundException();
      }

      // 1. 구독 상태 업데이트
      await tx
        .update(schema.subscriptions)
        .set({
          status: 'CANCELLED',
          isVoided: true,
          voidedAt: new Date(),
          voidReason: reason || 'User requested cancellation',
        })
        .where(eq(schema.subscriptions.id, currentSub.id));

      // 2. 권리 종료
      await tx
        .update(schema.subscriptionRights)
        .set({
          isActive: false,
          closedAt: new Date(),
        })
        .where(
          and(
            eq(schema.subscriptionRights.subscriptionId, currentSub.id),
            eq(schema.subscriptionRights.isActive, true),
          ),
        );

      // 3. 이벤트 생성 (카프카는 나중에 구현)
      const eventId = uuidv4();
      await tx.insert(schema.subscriptionEvents).values({
        id: eventId,
        eventType: 'CANCEL',
        userId,
        subscriptionId: currentSub.id,
        effectiveDate: new Date().toISOString().split('T')[0],
        eventPayload: {
          reason,
          refundableAmount: 0, // 환불 정책에 따라 계산 필요
        },
      });

      return {
        cancelledAt: new Date(),
        effectiveUntil: currentSub.endsAt,
      };
    });
  }

  /**
   * 일시정지 가능 여부 확인
   */
  private async checkPauseEligibility(userId: string, year: number) {
    // 연간 일시정지 사용량 조회
    const usage = await this.dbService.db
      .select()
      .from(schema.pauseUsageTracker)
      .where(
        and(
          eq(schema.pauseUsageTracker.userId, userId),
          eq(schema.pauseUsageTracker.year, year),
        ),
      )
      .limit(1);

    const currentUsage = usage[0]?.pauseCount || 0;

    // 정책 조회
    const policies = await this.dbService.db
      .select()
      .from(schema.subscriptionPolicies)
      .where(
        and(
          eq(schema.subscriptionPolicies.ruleType, 'MAX_PAUSES_PER_YEAR'),
          eq(schema.subscriptionPolicies.isActive, true),
        ),
      );

    const maxPauses = (policies[0]?.ruleValue as any)?.limit || 2;

    return {
      eligible: currentUsage < maxPauses,
      currentUsage,
      maxPauses,
      remainingPauses: maxPauses - currentUsage,
    };
  }

  /**
   * 구독 이력 조회
   */
  async getSubscriptionHistory(userId: string) {
    const result = await this.dbService.db
      .select({
        subscription: schema.subscriptions,
        plan: schema.subscriptionPlans,
        tier: schema.subscriptionTiers,
      })
      .from(schema.subscriptions)
      .innerJoin(
        schema.subscriptionPlans,
        eq(schema.subscriptions.planId, schema.subscriptionPlans.id),
      )
      .innerJoin(
        schema.subscriptionTiers,
        eq(schema.subscriptionPlans.tierId, schema.subscriptionTiers.id),
      )
      .where(eq(schema.subscriptions.userId, userId))
      .orderBy(schema.subscriptions.createdAt);

    return result.map(({ subscription, plan, tier }) => ({
      id: subscription.id,
      planId: plan.id,
      tierCode: tier.code,
      tierName: tier.name,
      status: subscription.status,
      startedAt: subscription.startedAt,
      endedAt: subscription.isVoided
        ? subscription.voidedAt?.toISOString()
        : null,
      changeType: subscription.changeType,
      adjustmentAmount: subscription.adjustmentAmount,
      price: plan.price,
      currency: plan.currency,
      durationDays: plan.durationDays,
      createdAt: subscription.createdAt.toISOString(),
    }));
  }

  // 카프카 이벤트 발행은 나중에 구현
}
