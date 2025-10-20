import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and } from 'drizzle-orm';

type Entitlement = typeof schema.subscriptionEntitlement.$inferSelect;

/**
 * EntitlementReader (Implementation Layer)
 *
 * 역할: 권한 데이터 조회
 * - 활성 권한 조회
 * - 권한 상세 조회 (계약, 플랜, 티어 포함)
 * - 권한 ID로 조회
 */
@Injectable()
export class EntitlementReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 활성 권한 조회
   */
  async findActiveEntitlement(userId: string): Promise<Entitlement | null> {
    const [entitlement] = await this.dbService.db
      .select()
      .from(schema.subscriptionEntitlement)
      .where(
        and(
          eq(schema.subscriptionEntitlement.userId, userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
        ),
      )
      .limit(1);

    return entitlement || null;
  }

  /**
   * 사용자 권한 상세 조회 (계약, 플랜, 티어 포함)
   */
  async getUserEntitlementDetails(userId: string) {
    return await this.dbService.db
      .select({
        entitlement: schema.subscriptionEntitlement,
        contract: schema.subscriptionContracts,
        plan: schema.plan,
        tier: schema.tiers,
      })
      .from(schema.subscriptionEntitlement)
      .innerJoin(
        schema.subscriptionContracts,
        and(
          eq(
            schema.subscriptionEntitlement.userId,
            schema.subscriptionContracts.userId,
          ),
          eq(schema.subscriptionContracts.isVoided, false),
        ),
      )
      .innerJoin(
        schema.plan,
        eq(schema.subscriptionContracts.planId, schema.plan.id),
      )
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(
        and(
          eq(schema.subscriptionEntitlement.userId, userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
        ),
      )
      .limit(1)
      .then((results) => (results.length > 0 ? results[0] : null));
  }

  /**
   * 권한 ID로 조회
   */
  async findById(entitlementId: string): Promise<Entitlement | null> {
    const [entitlement] = await this.dbService.db
      .select()
      .from(schema.subscriptionEntitlement)
      .where(eq(schema.subscriptionEntitlement.id, entitlementId))
      .limit(1);

    return entitlement || null;
  }
}
