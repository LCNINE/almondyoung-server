import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, inArray, gte } from 'drizzle-orm';

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
   *
   * @note isCurrent 플래그만 확인하며, endsAt 날짜는 체크하지 않습니다.
   * 스케줄러가 주기적으로 만료된 구독의 isCurrent를 false로 업데이트합니다.
   */
  async findActiveEntitlement(userId: string): Promise<Entitlement | null> {
    const [entitlement] = await this.dbService.db
      .select()
      .from(schema.subscriptionEntitlement)
      .where(and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)))
      .limit(1);

    return entitlement || null;
  }

  /**
   * 사용자 권한 상세 조회 (계약, 플랜, 티어 포함)
   *
   * @note endsAt 날짜는 체크하지 않고 isCurrent 플래그만 확인합니다.
   *
   * 이유: 만료일 당일 새벽에 결제 스케줄러가 실행되므로,
   * 만료일 00:00 ~ 결제 완료 시점 사이에 사용자가 접속해도
   * 멤버십 혜택을 계속 제공하기 위함입니다.
   *
   * 예시:
   * - 30일 23:59 → 멤버십 회원 ✅ (isCurrent=true)
   * - 31일 00:01 → 멤버십 회원 ✅ (isCurrent=true, endsAt 지났지만 무시)
   * - 31일 03:00 → 결제 성공 → endsAt 연장
   * - 31일 03:00 → 결제 실패 → 스케줄러가 isCurrent=false 처리
   *
   * @future 추후 개선 방안:
   * - 옵션 1: Grace Period 추가 (endsAt + 3일까지 유예)
   * - 옵션 2: 결제일을 만료일 1일 전으로 앞당김
   * - 옵션 3: endsAt 체크 추가 + 결제 실패 시 즉시 차단 (엄격한 정책)
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
          eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
          eq(schema.subscriptionContracts.isVoided, false),
        ),
      )
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(
        and(
          eq(schema.subscriptionEntitlement.userId, userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
          // endsAt 체크 안 함: 만료일 당일에도 결제 완료까지 멤버십 유지
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

  /**
   * 주어진 userId 중 멤버십이 활성(현재 권한 + 미만료)인 userId만 반환.
   * 일일 정합성 크론(channel-adapter)이 메두사 고객 그룹 add/remove 판정에 쓴다.
   */
  async getActiveUserIds(userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];

    const today = new Date().toISOString().split('T')[0];
    const rows = await this.dbService.db
      .selectDistinct({ userId: schema.subscriptionEntitlement.userId })
      .from(schema.subscriptionEntitlement)
      .where(
        and(
          inArray(schema.subscriptionEntitlement.userId, userIds),
          eq(schema.subscriptionEntitlement.isCurrent, true),
          gte(schema.subscriptionEntitlement.endsAt, today),
        ),
      );

    return rows.map((r) => r.userId);
  }

  async getBulkUserEntitlementDetails(userIds: string[]) {
    if (!userIds.length) return [];

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
          eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
          eq(schema.subscriptionContracts.isVoided, false),
        ),
      )
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(
        and(
          inArray(schema.subscriptionEntitlement.userId, userIds),
          eq(schema.subscriptionEntitlement.isCurrent, true),
        ),
      );
  }
}
