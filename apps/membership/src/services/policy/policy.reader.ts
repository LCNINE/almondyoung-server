import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, lte, gte, or, isNull } from 'drizzle-orm';
import { PolicyRuleType, PolicyResult } from '../../shared/schemas/policy.type';

/**
 * 정책 Reader (Data Access Layer)
 *
 * 역할: DB 조회만 담당
 * - 비즈니스 로직 없음
 * - 순수 데이터 조회
 */
@Injectable()
export class PolicyReader {
  private readonly logger = new Logger(PolicyReader.name);

  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 정책 조회 (티어별 우선순위)
   *
   * 우선순위:
   * 1. 티어별 정책 (tierId 일치)
   * 2. 전체 티어 정책 (tierId = null)
   */
  async findPolicy(
    ruleType: PolicyRuleType,
    tierId?: string,
  ): Promise<PolicyResult | null> {
    const today = new Date().toISOString().split('T')[0];

    // 1. 티어별 정책 조회 (우선)
    if (tierId) {
      const [tierPolicy] = await this.dbService.db
        .select()
        .from(schema.subscriptionPolicies)
        .where(
          and(
            eq(schema.subscriptionPolicies.ruleType, ruleType),
            eq(schema.subscriptionPolicies.tierId, tierId),
            eq(schema.subscriptionPolicies.isActive, true),
            or(
              isNull(schema.subscriptionPolicies.validFrom),
              lte(schema.subscriptionPolicies.validFrom, today),
            ),
            or(
              isNull(schema.subscriptionPolicies.validUntil),
              gte(schema.subscriptionPolicies.validUntil, today),
            ),
          ),
        )
        .limit(1);

      if (tierPolicy) {
        return tierPolicy;
      }
    }

    // 2. 전체 티어 정책 조회 (fallback)
    const [globalPolicy] = await this.dbService.db
      .select()
      .from(schema.subscriptionPolicies)
      .where(
        and(
          eq(schema.subscriptionPolicies.ruleType, ruleType),
          isNull(schema.subscriptionPolicies.tierId),
          eq(schema.subscriptionPolicies.isActive, true),
          or(
            isNull(schema.subscriptionPolicies.validFrom),
            lte(schema.subscriptionPolicies.validFrom, today),
          ),
          or(
            isNull(schema.subscriptionPolicies.validUntil),
            gte(schema.subscriptionPolicies.validUntil, today),
          ),
        ),
      )
      .limit(1);

    return globalPolicy || null;
  }

  /**
   * 정책 ID로 조회
   */
  async findById(id: string): Promise<PolicyResult | null> {
    const [policy] = await this.dbService.db
      .select()
      .from(schema.subscriptionPolicies)
      .where(eq(schema.subscriptionPolicies.id, id))
      .limit(1);

    return policy || null;
  }

  /**
   * 모든 활성 정책 조회
   */
  async findAllActive(): Promise<PolicyResult[]> {
    return await this.dbService.db
      .select()
      .from(schema.subscriptionPolicies)
      .where(eq(schema.subscriptionPolicies.isActive, true));
  }
}
