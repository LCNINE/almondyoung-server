import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import { EntitlementNotFoundException } from '../shared/exceptions/subscription.exceptions';
import { addDays } from 'date-fns';
import type {
  UserEntitlementResponse,
  SubscriptionEntitlement,
} from '../shared/schemas';
import { PlanService } from '../plan/plan.service';
import { DrizzleTransaction } from '../shared/schemas/types';

@Injectable()
export class EntitlementService {
  constructor(
    private readonly dbService: DbService<typeof schema>,
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
    tx: DrizzleTransaction, // 'any' 타입을 'DrizzleTransaction'으로 변경
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

  async getUserEntitlement(
    userId: string,
  ): Promise<UserEntitlementResponse | null> {
    const result = await this.dbService.db
      .select()
      .from(schema.subscriptionEntitlement)
      .where(
        and(
          eq(schema.subscriptionEntitlement.userId, userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
        ),
      )
      .limit(1);

    if (!result.length) {
      return null;
    }

    const entitlement = result[0];

    // Entitlement에 연결된 Contract와 Plan 정보 조회
    // 실제 프로덕션에서는 이 로직이 SubscriptionService에 있을 수 있습니다.
    const contract =
      await this.dbService.db.query.subscriptionContracts.findFirst({
        where: and(
          eq(schema.subscriptionContracts.userId, userId),
          eq(schema.subscriptionContracts.isVoided, false),
        ),
      });

    if (!contract) return null; // 비정상 상태

    const planDetails = await this.planService.getPlanDetails(contract.planId);
    if (!planDetails) return null; // 비정상 상태

    return {
      contract,
      entitlement,
      plan: planDetails,
      tier: planDetails.tier,
      isPaused: !!entitlement.pausedAt,
    };
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
   * 사용자 권한을 연장합니다.
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
    await this.dbService.db.transaction(async (tx) => {
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

      // 권한 연장 이벤트를 기록합니다.
      await tx
        .insert(schema.eventBatches)
        .values({
          type: 'ENTITLEMENT_EXTENDED',
          effectiveDate: new Date().toISOString().split('T')[0],
          adminId: adminId, // 관리자 ID 기록
        })
        .returning();

      const currentEndDate = new Date(activeEntitlement.endsAt);
      const newEndDate = addDays(currentEndDate, additionalDays);

      // 권한의 종료일을 업데이트합니다.
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          endsAt: newEndDate.toISOString().split('T')[0],
        })
        .where(eq(schema.subscriptionEntitlement.id, activeEntitlement.id));
    });
  }

  /**
   * 현재 활성화된 사용자 권한을 종료시킵니다. (내부용)
   * @param tx - Drizzle 트랜잭션 객체
   * @param userId - 사용자 ID
   * @param closedBatchId - 이 권한을 종료시킨 이벤트 배치의 ID
   */
  private async terminateActiveEntitlement(
    tx: DrizzleTransaction, // 'any' 타입을 'DrizzleTransaction'으로 변경
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
