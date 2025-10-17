import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and } from 'drizzle-orm';
import {
  PolicyRuleType,
  PolicyValue,
  PolicyResult,
} from '../../shared/schemas/policy.type';

/**
 * 정책 Manager (Business Logic Layer)
 *
 * 역할: 정책 생성/수정/삭제 로직
 * - 검증 로직 포함
 * - 트랜잭션 관리
 */
@Injectable()
export class PolicyManager {
  private readonly logger = new Logger(PolicyManager.name);

  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 정책 생성/업데이트 (UPSERT)
   */
  async upsertPolicy(
    ruleType: PolicyRuleType,
    ruleValue: PolicyValue,
    tierId?: string,
    validFrom?: string,
    validUntil?: string,
  ): Promise<PolicyResult> {
    // 검증: ruleValue가 객체인지 확인
    if (typeof ruleValue !== 'object' || ruleValue === null) {
      throw new Error('ruleValue must be a non-null object');
    }

    // 검증: validFrom이 validUntil보다 이전인지 확인
    if (validFrom && validUntil && validFrom > validUntil) {
      throw new Error('validFrom must be before validUntil');
    }

    const [policy] = await this.dbService.db
      .insert(schema.subscriptionPolicies)
      .values({
        ruleType,
        ruleValue,
        tierId: tierId || null,
        isActive: true,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
      })
      .onConflictDoUpdate({
        target: [
          schema.subscriptionPolicies.ruleType,
          schema.subscriptionPolicies.tierId,
        ],
        set: {
          ruleValue,
          validFrom: validFrom || null,
          validUntil: validUntil || null,
          updatedAt: new Date(),
        },
      })
      .returning();

    this.logger.log('Policy upserted', {
      ruleType,
      tierId: tierId || 'global',
    });

    return policy;
  }

  /**
   * 정책 비활성화
   */
  async deactivatePolicy(id: string): Promise<void> {
    await this.dbService.db
      .update(schema.subscriptionPolicies)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptionPolicies.id, id));

    this.logger.log('Policy deactivated', { id });
  }

  /**
   * 정책 활성화
   */
  async activatePolicy(id: string): Promise<void> {
    await this.dbService.db
      .update(schema.subscriptionPolicies)
      .set({
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptionPolicies.id, id));

    this.logger.log('Policy activated', { id });
  }

  /**
   * 정책 삭제 (물리 삭제)
   */
  async deletePolicy(id: string): Promise<void> {
    await this.dbService.db
      .delete(schema.subscriptionPolicies)
      .where(eq(schema.subscriptionPolicies.id, id));

    this.logger.log('Policy deleted', { id });
  }
}
