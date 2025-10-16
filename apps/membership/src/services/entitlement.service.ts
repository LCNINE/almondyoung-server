import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import { membershipSchema } from '../shared/schemas/entities/schema';
import { EntitlementNotFoundException } from '../shared/exceptions/subscription.exceptions';
import { addDays } from 'date-fns';
import type { SubscriptionEntitlement } from '../shared/schemas';
import { PlanService } from './plan.service';

@Injectable()
export class EntitlementService {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly planService: PlanService, // Tier 정보 조회를 위해 주입
  ) {}

  /**
   * 새로운 사용자 권한을 생성합니다.
   * 이전에 활성화된 권한이 있다면 자동으로 종료시킵니다.
   * @param tx - Drizzle 트랜잭션 객체
   * @param userId - 사용자 ID
   * @param tierId - 부여할 티어 ID
   * @param startsAt - 권한 시작일
   * @param endsAt - 권한 종료일
   * @param sourceBatchId - 이 권한을 생성한 이벤트 배치의 ID
   * @returns 생성된 SubscriptionEntitlement 객체
   */
  async createEntitlement(
    tx: any,
    userId: string,
    tierId: string,
    startsAt: Date,
    endsAt: Date,
    sourceBatchId: string,
  ): Promise<SubscriptionEntitlement> {
    // 1. 기존 활성 권한이 있다면 종료 처리
    await this.terminateActiveEntitlement(tx, userId, sourceBatchId);

    // 2. 새로운 권한 생성
    const [newEntitlement] = await tx
      .insert(schema.subscriptionEntitlement)
      .values({
        userId,
        tierId,
        startsAt: startsAt.toISOString().split('T')[0],
        endsAt: endsAt.toISOString().split('T')[0],
        isCurrent: true,
        sourceBatchId,
      })
      .returning();

    return newEntitlement;
  }

  async getUserEntitlement(userId: string) {
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
   * 여러 사용자의 활성 권한 상태를 일괄 조회합니다.
   * @param userIds - 조회할 사용자 ID 배열
   * @returns BulkEntitlementCheckResponse 객체
   */
  //   async bulkCheckEntitlements(
  //     userIds: string[],
  //   ): Promise<BulkSubscriptionCheckResponse> {
  //     const response: BulkSubscriptionCheckResponse = {};
  //     userIds.forEach((id) => {
  //       response[id] = { hasActiveEntitlement: false };
  //     });

  //     const entitlements = await this.dbService.db
  //       .select({
  //         userId: schema.subscriptionEntitlement.userId,
  //         endsAt: schema.subscriptionEntitlement.endsAt,
  //         pausedAt: schema.subscriptionEntitlement.pausedAt,
  //         tierCode: schema.tiers.code,
  //       })
  //       .from(schema.subscriptionEntitlement)
  //       .innerJoin(
  //         schema.tiers,
  //         eq(schema.subscriptionEntitlement.tierId, schema.tiers.id),
  //       )
  //       .where(
  //         and(
  //           inArray(schema.subscriptionEntitlement.userId, userIds),
  //           eq(schema.subscriptionEntitlement.isCurrent, true),
  //         ),
  //       );

  //     const today = new Date().toISOString().split('T')[0];
  //     entitlements.forEach((ent) => {
  //       const isExpired = ent.endsAt < today;
  //       response[ent.userId] = {
  //         hasActiveEntitlement: !isExpired,
  //         tierCode: ent.tierCode,
  //         isPaused: !!ent.pausedAt,
  //         endsAt: ent.endsAt,
  //       };
  //     });

  //     return response;
  //   }

  /**
   * 사용자 권한을 연장하거나 차감합니다.
   * @param userId - 사용자 ID
   * @param days - 추가/차감할 일수 (양수: 연장, 음수: 차감)
   * @param reason - 연장/차감 사유
   * @param adminId - 관리자 ID
   */
  async adjustEntitlement(
    userId: string,
    days: number,
    reason: string,
    adminId: string,
  ) {
    return await this.dbService.db.transaction(async (tx) => {
      const [activeEntitlement] = await tx
        .select()
        .from(schema.subscriptionEntitlement)
        .where(
          and(
            eq(schema.subscriptionEntitlement.userId, userId),
            eq(schema.subscriptionEntitlement.isCurrent, true),
          ),
        )
        .limit(1);

      if (!activeEntitlement) {
        throw new EntitlementNotFoundException();
      }

      const currentEndDate = new Date(activeEntitlement.endsAt);
      const newEndDate = addDays(currentEndDate, days);
      const today = new Date();

      // 차감으로 인해 종료일이 오늘보다 이전이 되는 경우 방지
      if (newEndDate < today && days < 0) {
        const maxReducibleDays = Math.floor(
          (currentEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
        throw new Error(
          `최대 ${maxReducibleDays}일까지만 차감할 수 있습니다. 현재 구독이 즉시 만료됩니다.`,
        );
      }

      const action = days > 0 ? 'extended' : 'reduced';
      const eventType =
        days > 0 ? 'ENTITLEMENT_EXTENDED' : 'ENTITLEMENT_REDUCED';

      // 이벤트 배치 생성
      const [eventBatch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: eventType,
          effectiveDate: new Date().toISOString().split('T')[0],
          adminId: adminId,
        })
        .returning();

      // 기존 entitlement 닫기 (이력 보존)
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: new Date(),
          closedBatchId: eventBatch.id,
        })
        .where(eq(schema.subscriptionEntitlement.id, activeEntitlement.id));

      // 새로운 entitlement 생성 (조정된 기간으로)
      const [newEntitlement] = await tx
        .insert(schema.subscriptionEntitlement)
        .values({
          userId,
          tierId: activeEntitlement.tierId,
          startsAt: activeEntitlement.startsAt, // 시작일은 동일
          endsAt: newEndDate.toISOString().split('T')[0], // 조정된 종료일
          isCurrent: true,
          sourceBatchId: eventBatch.id,
        })
        .returning();

      return newEntitlement;
    });
  }

  /**
   * 사용자 권한을 연장합니다. (기존 메서드 - 호환성 유지)
   * @param userId - 사용자 ID
   * @param additionalDays - 추가할 일수
   * @param reason - 연장 사유
   */
  async extendEntitlement(
    userId: string,
    additionalDays: number,
    reason: string,
    adminId?: string,
  ): Promise<void> {
    await this.adjustEntitlement(
      userId,
      additionalDays,
      reason,
      adminId || 'system',
    );
  }

  /**
   * 현재 활성화된 사용자 권한을 종료시킵니다. (내부용)
   * @param tx - Drizzle 트랜잭션 객체
   * @param userId - 사용자 ID
   * @param closedBatchId - 이 권한을 종료시킨 이벤트 배치의 ID
   */
  private async terminateActiveEntitlement(
    tx: any,
    userId: string,
    closedBatchId: string,
  ): Promise<void> {
    const activeEntitlements = await tx
      .select({ id: schema.subscriptionEntitlement.id })
      .from(schema.subscriptionEntitlement)
      .where(
        and(
          eq(schema.subscriptionEntitlement.userId, userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
        ),
      );

    if (activeEntitlements.length > 0) {
      const idsToTerminate = activeEntitlements.map((e) => e.id);
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: new Date(),
          closedBatchId,
        })
        .where(inArray(schema.subscriptionEntitlement.id, idsToTerminate));
    }
  }
}
