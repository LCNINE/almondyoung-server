import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, isNull } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import { PolicyViolationException } from '../shared/exceptions/subscription.exceptions';
import type { Policy, PolicyValidationContext } from '../shared/schemas';

// PolicyValidationContext 타입 정의 (실제 사용되는 필드들 포함)

/**
 * 정책 검증만 담당하는 서비스
 * 비즈니스 로직 실행 전 정책 위반 여부를 검사
 */
@Injectable()
export class PolicyValidationService {
  constructor(private readonly dbService: DbService<typeof schema>) {}

  /**
   * 주어진 액션과 컨텍스트에 대해 정책을 검증합니다.
   * 위반 시 PolicyViolationException을 던집니다.
   * @param action - 검증할 액션 (예: 'PAUSE_SUBSCRIPTION')
   * @param context - 검증에 필요한 데이터
   */
  async validate(
    action: string,
    context: PolicyValidationContext,
  ): Promise<void> {
    const policies = await this.getApplicablePolicies(context.tierId);

    // 모든 관련 정책을 순회하며 검증
    for (const policy of policies) {
      const result = this.evaluateRule(policy, action, context);
      if (!result.isValid) {
        // 첫 번째 위반 발견 시 즉시 예외 발생
        throw new PolicyViolationException(result.message as string);
      }
    }
    // 모든 정책을 통과하면 정상 종료
  }

  /**
   * 특정 액션에 대해 사용자가 수행 가능한지 확인합니다.
   * validate와 달리 예외를 던지지 않고 boolean을 반환합니다.
   */
  async canPerformAction(
    action: string,
    context: PolicyValidationContext,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      await this.validate(action, context);
      return { allowed: true };
    } catch (error) {
      if (error instanceof PolicyViolationException) {
        return {
          allowed: false,
          reason: error.message,
        };
      }
      throw error; // 다른 에러는 그대로 전파
    }
  }

  /**
   * 사용자에게 적용될 수 있는 모든 활성 정책을 조회합니다.
   * @param tierId - 사용자의 현재 티어 ID (선택 사항)
   */
  private async getApplicablePolicies(tierId?: string): Promise<Policy[]> {
    // 1. 글로벌 정책 (tierId가 NULL인 정책)
    const globalPolicies =
      this.dbService.db.query.subscriptionPolicies.findMany({
        where: and(
          eq(schema.subscriptionPolicies.isActive, true),
          isNull(schema.subscriptionPolicies.tierId),
        ),
      });

    // 2. 사용자 티어 전용 정책
    const tierPolicies = tierId
      ? this.dbService.db.query.subscriptionPolicies.findMany({
          where: and(
            eq(schema.subscriptionPolicies.isActive, true),
            eq(schema.subscriptionPolicies.tierId, tierId),
          ),
        })
      : Promise.resolve([]);

    const [global, tier] = await Promise.all([globalPolicies, tierPolicies]);

    // 티어 정책을 우선적으로 검사 (더 구체적인 정책을 먼저)
    return [...tier, ...global];
  }

  /**
   * 단일 정책 규칙을 평가합니다.
   * @returns 검증 결과와 위반 시 메시지
   */
  private evaluateRule(
    policy: Policy,
    action: string,
    context: PolicyValidationContext,
  ): { isValid: boolean; message?: string } {
    // 이 정책이 현재 action과 관련이 없으면 항상 통과
    if (!this.isActionRelevant(policy.ruleType, action)) {
      return { isValid: true };
    }

    switch (policy.ruleType) {
      case 'MAX_PAUSES_PER_YEAR': {
        const maxPauses = (policy.ruleValue as { limit: number }).limit;
        const currentPauses = context.pauseCount || 0;
        if (currentPauses >= maxPauses) {
          return {
            isValid: false,
            message: `연간 일시정지 한도(${maxPauses}회)를 초과했습니다.`,
          };
        }
        break;
      }

      case 'MIN_PAUSE_DURATION_DAYS': {
        const minDays = (policy.ruleValue as { minDays: number }).minDays;
        const { pauseStartDate, pauseEndDate } = context;
        if (pauseStartDate && pauseEndDate) {
          const duration =
            (new Date(pauseEndDate).getTime() -
              new Date(pauseStartDate).getTime()) /
            (1000 * 3600 * 24);
          if (duration < minDays) {
            return {
              isValid: false,
              message: `일시정지 기간은 최소 ${minDays}일 이상이어야 합니다.`,
            };
          }
        }
        break;
      }

      case 'PAUSE_COOLDOWN_DAYS': {
        const cooldownDays = (policy.ruleValue as { days: number }).days;
        const { lastPauseEndDate } = context;
        if (lastPauseEndDate) {
          const daysSinceLastPause =
            (new Date().getTime() - new Date(lastPauseEndDate).getTime()) /
            (1000 * 3600 * 24);
          if (daysSinceLastPause < cooldownDays) {
            return {
              isValid: false,
              message: `마지막 일시정지 종료 후 ${cooldownDays}일이 지나야 다시 일시정지할 수 있습니다.`,
            };
          }
        }
        break;
      }

      case 'PLAN_CHANGE_COOLDOWN_DAYS': {
        const cooldownDays = (policy.ruleValue as { days: number }).days;
        const { lastPlanChangeDate } = context;
        if (lastPlanChangeDate) {
          const daysSinceLastChange =
            (new Date().getTime() - new Date(lastPlanChangeDate).getTime()) /
            (1000 * 3600 * 24);
          if (daysSinceLastChange < cooldownDays) {
            return {
              isValid: false,
              message: `플랜 변경 후 ${cooldownDays}일이 지나야 다시 변경할 수 있습니다.`,
            };
          }
        }
        break;
      }

      case 'DOWNGRADE_RESTRICTIONS': {
        const restrictions = policy.ruleValue as {
          allowDowngrade: boolean;
          minMonthsBeforeDowngrade?: number;
        };

        if (!restrictions.allowDowngrade && context.isDowngrade) {
          return {
            isValid: false,
            message: '현재 티어에서는 다운그레이드가 허용되지 않습니다.',
          };
        }

        if (
          restrictions.minMonthsBeforeDowngrade &&
          context.subscriptionStartDate
        ) {
          const monthsSinceStart =
            (new Date().getTime() -
              new Date(context.subscriptionStartDate).getTime()) /
            (1000 * 3600 * 24 * 30);
          if (monthsSinceStart < restrictions.minMonthsBeforeDowngrade) {
            return {
              isValid: false,
              message: `구독 시작 후 ${restrictions.minMonthsBeforeDowngrade}개월이 지나야 다운그레이드할 수 있습니다.`,
            };
          }
        }
        break;
      }

      // 추가 정책 규칙들...
    }

    return { isValid: true };
  }

  /**
   * 정책 타입이 특정 액션과 관련이 있는지 확인하는 헬퍼 함수
   */
  private isActionRelevant(ruleType: string, action: string): boolean {
    const relevanceMap: Record<string, string[]> = {
      PAUSE_SUBSCRIPTION: [
        'MAX_PAUSES_PER_YEAR',
        'MIN_PAUSE_DURATION_DAYS',
        'PAUSE_COOLDOWN_DAYS',
      ],
      CHANGE_PLAN: ['PLAN_CHANGE_COOLDOWN_DAYS', 'DOWNGRADE_RESTRICTIONS'],
      CANCEL_SUBSCRIPTION: ['MIN_SUBSCRIPTION_PERIOD', 'CANCELLATION_COOLDOWN'],
      RESUME_SUBSCRIPTION: ['MIN_PAUSE_BEFORE_RESUME'],
    };

    return relevanceMap[action]?.includes(ruleType) ?? false;
  }

  /**
   * 특정 사용자에게 적용되는 모든 정책 규칙을 반환합니다.
   * UI에서 사용자에게 정책을 안내할 때 유용합니다.
   */
  async getUserApplicablePolicies(
    userId: string,
    tierId?: string,
  ): Promise<{
    globalPolicies: Policy[];
    tierPolicies: Policy[];
  }> {
    const globalPolicies =
      await this.dbService.db.query.subscriptionPolicies.findMany({
        where: and(
          eq(schema.subscriptionPolicies.isActive, true),
          isNull(schema.subscriptionPolicies.tierId),
        ),
      });

    const tierPolicies = tierId
      ? await this.dbService.db.query.subscriptionPolicies.findMany({
          where: and(
            eq(schema.subscriptionPolicies.isActive, true),
            eq(schema.subscriptionPolicies.tierId, tierId),
          ),
        })
      : [];

    return {
      globalPolicies,
      tierPolicies,
    };
  }
}
