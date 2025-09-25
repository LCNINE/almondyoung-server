import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, desc, isNull } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import {
  EntitlementNotFoundException,
  BadRequestException,
} from '../shared/exceptions/subscription.exceptions';
import { addDays, differenceInDays } from 'date-fns';
import { DrizzleTransaction } from '../shared/schemas/types';

@Injectable()
export class PauseService {
  constructor(private readonly dbService: DbService<typeof schema>) {}

  /**
   * 구독을 일시정지합니다.
   * PolicyGuard에서 모든 정책 검증이 완료되었다고 가정합니다.
   * @param userId - 사용자 ID
   * @param startDate - 일시정지 시작일
   * @param endDate - 일시정지 종료일
   * @param reason - 일시정지 사유 (선택)
   */
  async pauseSubscription(
    userId: string,
    startDate: Date,
    endDate: Date,
    reason?: string,
  ) {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      // 1. 현재 활성 상태이며, 일시정지 상태가 아닌 권한을 찾습니다.
      const entitlement = await tx.query.subscriptionEntitlement.findFirst({
        where: and(
          eq(schema.subscriptionEntitlement.userId, userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
          isNull(schema.subscriptionEntitlement.pausedAt),
        ),
      });

      if (!entitlement) {
        throw new EntitlementNotFoundException();
      }

      const now = new Date();

      // 2. 이벤트 배치를 생성합니다.
      const [eventBatch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_PAUSED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 3. 일시정지 기간 계산
      const pauseDurationDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // 4. 기존 entitlement의 종료일에 일시정지 기간만큼 연장
      const originalEndsAt = new Date(entitlement.endsAt);
      const adjustedEndsAt = addDays(originalEndsAt, pauseDurationDays);

      // 5. 일시정지 기간(pausePeriods) 레코드를 생성합니다.
      const [pausePeriod] = await tx
        .insert(schema.pausePeriods)
        .values({
          userId,
          startsAt: startDate.toISOString().split('T')[0],
          endsAt: endDate.toISOString().split('T')[0],
          reason,
        })
        .returning();

      // 6. pauseEntitlementVoids에 기록 (원래 종료일과 조정된 종료일 추적)
      await tx
        .insert(schema.pauseEntitlementVoids)
        .values({
          pauseId: pausePeriod.id,
          entitlementId: entitlement.id,
          originalEndsAt: originalEndsAt.toISOString().split('T')[0],
          adjustedEndsAt: adjustedEndsAt.toISOString().split('T')[0],
        });

      // 7. 기존 entitlement 닫기
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: now,
          closedBatchId: eventBatch.id,
        })
        .where(eq(schema.subscriptionEntitlement.id, entitlement.id));

      // 8. 새로운 entitlement 생성 (일시정지 상태 + 연장된 종료일)
      await tx
        .insert(schema.subscriptionEntitlement)
        .values({
          userId,
          tierId: entitlement.tierId,
          startsAt: entitlement.startsAt,
          endsAt: adjustedEndsAt.toISOString().split('T')[0],
          isCurrent: true,
          sourceBatchId: eventBatch.id,
          pausedAt: now,
        });

      return {
        pauseId: pausePeriod.id,
        pausedAt: now,
      };
    });
  }

  /**
   * 구독을 재개합니다.
   * @param userId - 사용자 ID
   */
  async resumeSubscription(userId: string) {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      // 1. 현재 활성 상태이며, 일시정지 상태인 권한을 찾습니다.
      const entitlement = await tx.query.subscriptionEntitlement.findFirst({
        where: and(
          eq(schema.subscriptionEntitlement.userId, userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
        ),
      });

      if (!entitlement || !entitlement.pausedAt) {
        throw new BadRequestException('일시정지 상태인 구독이 없습니다.');
      }

      const now = new Date();

      // 2. 이벤트 배치를 생성합니다.
      const [eventBatch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_RESUMED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 3. 기존 entitlement 닫기
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: now,
          closedBatchId: eventBatch.id,
        })
        .where(eq(schema.subscriptionEntitlement.id, entitlement.id));

      // 4. 새로운 entitlement 생성 (일시정지 해제)
      await tx
        .insert(schema.subscriptionEntitlement)
        .values({
          userId,
          tierId: entitlement.tierId,
          startsAt: entitlement.startsAt,
          endsAt: entitlement.endsAt, // 종료일은 이미 일시정지 시 연장됨
          isCurrent: true,
          sourceBatchId: eventBatch.id,
          pausedAt: null, // 일시정지 해제
        });

      // 참고: pausePeriods 테이블의 상태를 'ENDED'로 업데이트하는 로직이 필요하다면
      // 스키마에 status 컬럼을 추가하고 여기서 업데이트해야 합니다.

      return {
        resumedAt: now,
        newEndsAt: new Date(entitlement.endsAt),
      };
    });
  }

  /**
   * [신규] 특정 사용자의 모든 일시정지 이력을 조회합니다.
   * @param userId - 사용자 ID
   * @returns 사용자의 일시정지 기록 배열
   */
  async getPauseHistory(userId: string) {
    const history = await this.dbService.db.query.pausePeriods.findMany({
      where: eq(schema.pausePeriods.userId, userId),
      orderBy: [desc(schema.pausePeriods.createdAt)],
    });
    return history;
  }
}
