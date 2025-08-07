import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, isNull, desc, SQL } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import { PolicyViolationException } from '../shared/exceptions/subscription.exceptions';
import type {
  Policy,
  PolicyListResponse,
  PolicyValidationContext,
  CreatePolicyRequest,
  UpdatePolicyRequest,
  GetPoliciesQuery,
} from '../shared/schemas';

@Injectable()
export class PolicyService {
  constructor(private readonly dbService: DbService<typeof schema>) {}

  // =================================================================
  // 1. 정책 관리 (CRUD)
  // =================================================================

  async createPolicy(dto: CreatePolicyRequest): Promise<Policy> {
    // 간단한 중복 체크: 동일 타입, 동일 티어에 활성 정책이 있는지 확인
    const existing =
      await this.dbService.db.query.subscriptionPolicies.findFirst({
        where: and(
          eq(schema.subscriptionPolicies.ruleType, dto.ruleType),
          dto.tierId
            ? eq(schema.subscriptionPolicies.tierId, dto.tierId)
            : isNull(schema.subscriptionPolicies.tierId),
          eq(schema.subscriptionPolicies.isActive, true),
        ),
      });

    if (existing) {
      throw new BadRequestException(
        `Active policy of type ${dto.ruleType} already exists.`,
      );
    }

    const [newPolicy] = await this.dbService.db
      .insert(schema.subscriptionPolicies)
      .values(dto)
      .returning();
    return newPolicy;
  }

  async getPolicyById(policyId: string): Promise<Policy> {
    const policy = await this.dbService.db.query.subscriptionPolicies.findFirst(
      {
        where: eq(schema.subscriptionPolicies.id, policyId),
      },
    );
    if (!policy) {
      throw new NotFoundException(`Policy with ID ${policyId} not found.`);
    }
    return policy;
  }

  async getAllPolicies(query: GetPoliciesQuery): Promise<PolicyListResponse> {
    const { ruleType, tierId, isActive = true, page = 1, limit = 20 } = query;
    const conditions: SQL[] = [];
    if (ruleType)
      conditions.push(eq(schema.subscriptionPolicies.ruleType, ruleType));
    if (tierId) conditions.push(eq(schema.subscriptionPolicies.tierId, tierId));
    conditions.push(eq(schema.subscriptionPolicies.isActive, isActive));

    const result = await this.dbService.db.query.subscriptionPolicies.findMany({
      where: and(...conditions),
      orderBy: [desc(schema.subscriptionPolicies.createdAt)],
      limit: limit,
      offset: (page - 1) * limit,
    });

    // total count는 별도로 조회해야 하지만, 여기서는 간소화합니다.
    return { policies: result, total: result.length, page, limit };
  }

  async updatePolicy(
    policyId: string,
    dto: UpdatePolicyRequest,
  ): Promise<Policy> {
    const [updatedPolicy] = await this.dbService.db
      .update(schema.subscriptionPolicies)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(schema.subscriptionPolicies.id, policyId))
      .returning();

    if (!updatedPolicy) {
      throw new NotFoundException(`Policy with ID ${policyId} not found.`);
    }
    return updatedPolicy;
  }

  async deactivatePolicy(policyId: string): Promise<{ success: boolean }> {
    await this.updatePolicy(policyId, { isActive: false });
    return { success: true };
  }

  // =================================================================
  // 2. 정책 검증 (Validation)
  // =================================================================

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

    // for...of 루프를 사용하여 조기 종료가 가능하도록 구현
    for (const policy of policies) {
      const result = this.evaluateRule(policy, action, context);
      if (!result.isValid) {
        // 첫 번째 위반 발견 시 즉시 예외 발생
        throw new PolicyViolationException(result.message as string);
      }
    }
    // 모든 정책을 통과하면 아무것도 반환하지 않고 종료
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

    // 티어 정책을 글로벌 정책보다 우선적으로 검사하기 위해 배열 순서를 조정할 수 있습니다.
    // 여기서는 티어 정책을 앞에 두어 더 먼저 검사하도록 합니다.
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

      // ... 다른 정책 규칙들에 대한 case 추가 ...
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
    };
    return relevanceMap[action]?.includes(ruleType) ?? false;
  }
}
