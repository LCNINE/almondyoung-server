import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, isNull, or, lte, gte } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import type {
  PolicyValidationResult,
  PolicyViolation,
  PolicyWarning,
  AppliedPolicy,
  PolicyContext,
  PolicyResponse,
  Policy,
  ApplicablePolicy,
  PolicyEngineResult,
} from '../shared/schemas/types';

// 추가 타입 정의
interface ComplianceResult {
  isCompliant: boolean;
  totalPolicies: number;
  compliantPolicies: number;
  violationCount: number;
  warningCount: number;
  details: Array<{
    policyId: string;
    ruleType: string;
    isCompliant: boolean;
    violations: PolicyViolation[];
    warnings: PolicyWarning[];
  }>;
}

/**
 * 정책 검증 엔진 서비스
 * 정책 규칙을 평가하고 검증 결과를 제공합니다.
 */
@Injectable()
export class PolicyEngineService {
  private readonly logger = new Logger(PolicyEngineService.name);
  private policyCache = new Map<string, Policy>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5분

  constructor(private readonly dbService: DbService<typeof schema>) {}

  /**
   * 사용자 요청에 대해 정책을 검증합니다.
   */
  async validateRequest(
    userId: string,
    action: string,
    context: Record<string, any>,
    policyIds?: string[],
  ): Promise<PolicyValidationResult> {
    const startTime = Date.now();
    
    try {
      // 1. 사용자 컨텍스트 구성
      const policyContext = await this.buildPolicyContext(userId, context);
      
      // 2. 적용 가능한 정책들 조회
      const applicablePolicies = await this.getApplicablePoliciesInternal(
        policyContext, 
        policyIds
      );
      
      // 3. 정책 규칙 평가
      const evaluationResults = await Promise.all(
        (applicablePolicies || []).map(policy => 
          this.evaluatePolicyRule(policy, action, policyContext)
        )
      );
      
      // 4. 결과 집계
      const violatedPolicies: PolicyViolation[] = [];
      const warnings: PolicyWarning[] = [];
      const appliedPolicies: AppliedPolicy[] = [];
      
      evaluationResults.forEach((result, index) => {
        const policy = applicablePolicies[index];
        
        if (result.violations.length > 0) {
          violatedPolicies.push(...result.violations);
        }
        
        if (result.warnings.length > 0) {
          warnings.push(...result.warnings);
        }
        
        if (result.applied) {
          appliedPolicies.push({
            policyId: policy.id,
            policyName: `${policy.ruleType}_${policy.tierId || 'GLOBAL'}`,
            ruleType: policy.ruleType,
            appliedValue: result.appliedValue,
            context: policyContext,
          });
        }
      });
      
      const executionTime = Date.now() - startTime;
      
      return {
        isValid: violatedPolicies.length === 0,
        violatedPolicies,
        warnings,
        appliedPolicies,
        executionTime,
      };
      
    } catch (error) {
      this.logger.error(`Policy validation failed for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 사용자에게 적용 가능한 정책들을 조회합니다.
   */
  async getApplicablePolicies(
    userId: string,
    context: Record<string, any>,
  ): Promise<PolicyResponse[]> {
    const policyContext = await this.buildPolicyContext(userId, context);
    const policies = await this.getApplicablePoliciesInternal(policyContext);
    
    return (policies || []).map(policy => ({
      id: policy.id,
      ruleType: policy.ruleType,
      ruleValue: policy.ruleValue as Record<string, any>,
      tierId: policy.tierId || undefined,
      isActive: policy.isActive,
      validFrom: policy.validFrom || undefined,
      validUntil: policy.validUntil || undefined,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    }));
  }

  /**
   * 사용자별 적용 가능한 정책들을 우선순위와 함께 조회합니다.
   */
  async getApplicablePoliciesWithPriority(
    userId: string,
    context: Record<string, any>
  ): Promise<ApplicablePolicy[]> {
    const policyContext = await this.buildPolicyContext(userId, context);
    const policies = await this.getApplicablePoliciesInternal(policyContext);
    
    return (policies || []).map(policy => {
      const priority = this.calculatePolicyPriority(policy, policyContext);
      return {
        policy: {
          id: policy.id,
          ruleType: policy.ruleType,
          ruleValue: policy.ruleValue as Record<string, any>,
          tierId: policy.tierId || undefined,
          isActive: policy.isActive,
          validFrom: policy.validFrom || undefined,
          validUntil: policy.validUntil || undefined,
          createdAt: policy.createdAt.toISOString(),
          updatedAt: policy.updatedAt.toISOString(),
        },
        isApplicable: true,
        priority,
      };
    }).sort((a, b) => b.priority - a.priority);
  }

  /**
   * 정책을 사용자에게 적용하고 결과를 반환합니다.
   * 
   * @param userId - 사용자 ID
   * @param action - 수행할 액션
   * @param context - 추가 컨텍스트 정보
   * @returns 정책 엔진 실행 결과
   */
  async applyPolicies(
    userId: string,
    action: string,
    context: Record<string, any>
  ): Promise<PolicyEngineResult> {
    const validationResult = await this.validateRequest(userId, action, context);
    
    const baseResult = {
      policies: validationResult.appliedPolicies,
      metadata: {
        executionTime: validationResult.executionTime,
      },
    };

    if (!validationResult.isValid) {
      return {
        ...baseResult,
        decision: 'DENY',
        violations: validationResult.violatedPolicies,
        warnings: validationResult.warnings,
        metadata: {
          ...baseResult.metadata,
          reason: 'Policy violations detected',
        },
      };
    }

    if (validationResult.warnings.length > 0) {
      return {
        ...baseResult,
        decision: 'WARNING',
        violations: [],
        warnings: validationResult.warnings,
        metadata: {
          ...baseResult.metadata,
          reason: 'Warnings detected but action allowed',
        },
      };
    }

    return {
      ...baseResult,
      decision: 'ALLOW',
      violations: [],
      warnings: [],
      metadata: {
        ...baseResult.metadata,
        reason: 'All policies satisfied',
      },
    };
  }

  /**
   * 정책 준수 여부를 확인합니다.
   */
  async checkPolicyCompliance(
    userId: string,
    policies: Policy[]
  ): Promise<ComplianceResult> {
    const policyContext = await this.buildPolicyContext(userId, {});
    const complianceChecks = await Promise.all(
      policies.map(async policy => {
        const result = await this.evaluatePolicyRule(policy, 'COMPLIANCE_CHECK', policyContext);
        return {
          policyId: policy.id,
          ruleType: policy.ruleType,
          isCompliant: result.violations.length === 0,
          violations: result.violations,
          warnings: result.warnings,
        };
      })
    );

    const totalViolations = complianceChecks.reduce((sum, check) => sum + check.violations.length, 0);
    const totalWarnings = complianceChecks.reduce((sum, check) => sum + check.warnings.length, 0);

    return {
      isCompliant: totalViolations === 0,
      totalPolicies: policies.length,
      compliantPolicies: complianceChecks.filter(c => c.isCompliant).length,
      violationCount: totalViolations,
      warningCount: totalWarnings,
      details: complianceChecks,
    };
  }

  /**
   * 티어별 정책 필터링을 수행합니다.
   */
  async filterPoliciesByTier(
    policies: Policy[],
    tierId: string
  ): Promise<Policy[]> {
    return policies.filter(policy => 
      !policy.tierId || policy.tierId === tierId
    );
  }

  /**
   * 정책 캐시를 새로고침합니다.
   */
  async refreshPolicyCache(): Promise<void> {
    this.policyCache.clear();
    this.cacheExpiry.clear();
    this.logger.log('Policy cache refreshed');
  }



  /**
   * 캐시에서 정책을 조회합니다.
   */
  async getPolicyFromCache(policyId: string): Promise<Policy | null> {
    const now = Date.now();
    const expiry = this.cacheExpiry.get(policyId);
    
    if (expiry && now > expiry) {
      this.policyCache.delete(policyId);
      this.cacheExpiry.delete(policyId);
      return null;
    }
    
    const cachedPolicy = this.policyCache.get(policyId);
    if (cachedPolicy) {
      return cachedPolicy;
    }
    
    return null;
  }

  /**
   * 사용자 컨텍스트를 구성합니다.
   */
  private async buildPolicyContext(userId: string, context: Record<string, any>): Promise<PolicyContext> {
    // 사용자의 현재 구독 정보 조회
    const subscription = await this.dbService.db
      .select({
        id: schema.subscriptions.id,
        status: schema.subscriptions.status,
        planId: schema.subscriptions.planId,
        createdAt: schema.subscriptions.createdAt,
      })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, userId))
      .orderBy(schema.subscriptions.createdAt)
      .limit(1)
      .then(results => results[0] || null);

    let tierInfo: { id: string; code: string; priorityLevel: number } | null = null;
    if (subscription?.planId) {
      const plan = await this.dbService.db
        .select({
          tierId: schema.subscriptionPlans.tierId,
        })
        .from(schema.subscriptionPlans)
        .where(eq(schema.subscriptionPlans.id, subscription.planId))
        .limit(1)
        .then(results => results[0] || null);

      if (plan?.tierId) {
        tierInfo = await this.dbService.db
          .select({
            id: schema.subscriptionTiers.id,
            code: schema.subscriptionTiers.code,
            priorityLevel: schema.subscriptionTiers.priorityLevel,
          })
          .from(schema.subscriptionTiers)
          .where(eq(schema.subscriptionTiers.id, plan.tierId))
          .limit(1)
          .then(results => results[0] || null);
      }
    }

    return {
      userId,
      tierId: tierInfo?.id,
      subscriptionId: subscription?.id,
      currentDate: new Date().toISOString(),
      userMetadata: {
        subscriptionStatus: subscription?.status,
        tierCode: tierInfo?.code,
        tierPriority: tierInfo?.priorityLevel,
        ...context,
      },
    };
  }

  /**
   * 적용 가능한 정책들을 내부적으로 조회합니다.
   */
  private async getApplicablePoliciesInternal(
    context: PolicyContext, 
    policyIds?: string[]
  ): Promise<Policy[]> {
    const currentDateString = new Date().toISOString().split('T')[0]; // YYYY-MM-DD 형식
    
    let whereConditions = and(
      eq(schema.subscriptionPolicies.isActive, true),
      or(
        isNull(schema.subscriptionPolicies.validFrom),
        lte(schema.subscriptionPolicies.validFrom, currentDateString)
      ),
      or(
        isNull(schema.subscriptionPolicies.validUntil),
        gte(schema.subscriptionPolicies.validUntil, currentDateString)
      )
    );

    // 특정 정책 ID들이 지정된 경우 필터링
    if (policyIds && policyIds.length > 0) {
      whereConditions = and(
        whereConditions,
        // TODO: drizzle-orm의 inArray 함수 사용 필요
        // inArray(schema.subscriptionPolicies.id, policyIds)
      );
    }

    // 티어별 정책 필터링
    if (context.tierId) {
      whereConditions = and(
        whereConditions,
        or(
          isNull(schema.subscriptionPolicies.tierId),
          eq(schema.subscriptionPolicies.tierId, context.tierId)
        )
      );
    } else {
      whereConditions = and(
        whereConditions,
        isNull(schema.subscriptionPolicies.tierId)
      );
    }

    const policies = await this.dbService.db
      .select()
      .from(schema.subscriptionPolicies)
      .where(whereConditions)
      .orderBy(schema.subscriptionPolicies.createdAt);

    return policies;
  }

  /**
   * 정책 규칙을 평가합니다.
   */
  private async evaluatePolicyRule(
    policy: Policy, 
    action: string, 
    context: PolicyContext
  ): Promise<{
    violations: PolicyViolation[];
    warnings: PolicyWarning[];
    applied: boolean;
    appliedValue?: any;
  }> {
    const violations: PolicyViolation[] = [];
    const warnings: PolicyWarning[] = [];
    let applied = false;
    let appliedValue: any = null;

    try {
      switch (policy.ruleType) {
        case 'MAX_PAUSES_PER_YEAR':
          if (action === 'PAUSE_SUBSCRIPTION') {
            const result = await this.evaluateMaxPausesPerYear(policy, context);
            if (!result.isValid) {
              violations.push({
                policyId: policy.id,
                policyName: 'MAX_PAUSES_PER_YEAR',
                ruleType: policy.ruleType,
                violationType: 'QUOTA_EXCEEDED',
                message: result.message,
                severity: 'ERROR',
                suggestedAction: '내년까지 기다리거나 고객 지원에 문의하세요.',
              });
            } else {
              applied = true;
              appliedValue = result.appliedValue;
            }
          }
          break;

        case 'MIN_PAUSE_DURATION_DAYS':
          if (action === 'PAUSE_SUBSCRIPTION') {
            const result = await this.evaluateMinPauseDuration(policy, context);
            if (!result.isValid) {
              violations.push({
                policyId: policy.id,
                policyName: 'MIN_PAUSE_DURATION_DAYS',
                ruleType: policy.ruleType,
                violationType: 'DURATION_TOO_SHORT',
                message: result.message,
                severity: 'ERROR',
                suggestedAction: `최소 ${result.minDays}일 이상 일시정지해야 합니다.`,
              });
            } else {
              applied = true;
              appliedValue = result.appliedValue;
            }
          }
          break;

        default:
          this.logger.warn(`Unknown policy rule type: ${policy.ruleType}`);
          break;
      }
    } catch (error) {
      this.logger.error(`Error evaluating policy ${policy.id}:`, error);
      violations.push({
        policyId: policy.id,
        policyName: policy.ruleType,
        ruleType: policy.ruleType,
        violationType: 'EVALUATION_ERROR',
        message: '정책 평가 중 오류가 발생했습니다.',
        severity: 'ERROR',
      });
    }

    return { violations, warnings, applied, appliedValue };
  }

  /**
   * 연간 최대 일시정지 횟수 정책을 평가합니다.
   */
  private async evaluateMaxPausesPerYear(
    policy: Policy, 
    context: PolicyContext
  ): Promise<{ isValid: boolean; message: string; appliedValue?: any; minDays?: number }> {
    const ruleValue = policy.ruleValue as { maxPauses: number };
    const currentYear = new Date().getFullYear();
    
    // 올해 일시정지 사용량 조회
    const usageTracker = await this.dbService.db
      .select()
      .from(schema.pauseUsageTracker)
      .where(and(
        eq(schema.pauseUsageTracker.userId, context.userId),
        eq(schema.pauseUsageTracker.year, currentYear)
      ))
      .limit(1)
      .then(results => results[0] || null);

    const currentUsage = usageTracker?.pauseCount || 0;
    const maxPauses = ruleValue.maxPauses;

    if (currentUsage >= maxPauses) {
      return {
        isValid: false,
        message: `연간 일시정지 한도(${maxPauses}회)를 초과했습니다. 현재 사용량: ${currentUsage}회`,
      };
    }

    return {
      isValid: true,
      message: `일시정지 가능 (${currentUsage}/${maxPauses})`,
      appliedValue: { currentUsage, maxPauses, remaining: maxPauses - currentUsage },
    };
  }

  /**
   * 최소 일시정지 기간 정책을 평가합니다.
   */
  private async evaluateMinPauseDuration(
    policy: Policy, 
    context: PolicyContext
  ): Promise<{ isValid: boolean; message: string; appliedValue?: any; minDays?: number }> {
    const ruleValue = policy.ruleValue as { minDays: number };
    const minDays = ruleValue.minDays;
    
    // 컨텍스트에서 요청된 일시정지 기간 확인
    const startDate = context.userMetadata?.startDate;
    const endDate = context.userMetadata?.endDate;
    
    if (!startDate || !endDate) {
      return {
        isValid: true,
        message: '일시정지 기간이 지정되지 않았습니다.',
        appliedValue: { minDays },
      };
    }

    const requestedDays = Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (requestedDays < minDays) {
      return {
        isValid: false,
        message: `일시정지 기간이 너무 짧습니다. 최소 ${minDays}일 필요, 요청: ${requestedDays}일`,
        minDays,
      };
    }

    return {
      isValid: true,
      message: `일시정지 기간이 적절합니다 (${requestedDays}일)`,
      appliedValue: { minDays, requestedDays },
    };
  }

  /**
   * 정책 우선순위를 계산합니다.
   */
  private calculatePolicyPriority(policy: Policy, context: PolicyContext): number {
    let priority = 0;
    
    // 티어별 정책이 글로벌 정책보다 높은 우선순위
    if (policy.tierId) {
      priority += 100;
      
      // 사용자의 현재 티어와 일치하면 추가 점수
      if (policy.tierId === context.tierId) {
        priority += 50;
      }
    }
    
    // 최신 정책일수록 높은 우선순위
    const daysSinceCreation = Math.floor(
      (Date.now() - new Date(policy.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    priority += Math.max(0, 30 - daysSinceCreation);
    
    // 정책 타입별 우선순위
    const typesPriority: Record<string, number> = {
      'MAX_PAUSES_PER_YEAR': 10,
      'MIN_PAUSE_DURATION_DAYS': 8,
      'PAUSE_COOLDOWN_DAYS': 6,
      'PLAN_CHANGE_COOLDOWN_DAYS': 5,
      'TIER_SPECIFIC_LIMITS': 15,
    };
    
    priority += typesPriority[policy.ruleType] || 0;
    
    return priority;
  }


}