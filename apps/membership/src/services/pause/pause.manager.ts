import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { addDays } from 'date-fns';
import { DrizzleTransaction } from '../../shared/schemas/types';

export interface PauseResult {
  pauseEventId: string;
  adjustedEndsAt: string;
  pauseDurationDays: number;
}

export interface ResumeResult {
  resumeEventId: string;
  endsAt: string;
}

/**
 * PauseManager (Implementation Layer)
 *
 * 역할: 일시정지 생성 및 재개 처리
 * - 일시정지 시작 (권한 연장 포함)
 * - 일시정지 재개
 * - 이벤트 배치 및 이력 기록
 */
@Injectable()
export class PauseManager {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 구독 일시정지 시작
   *
   * @param userId - 사용자 ID
   * @param entitlement - 현재 활성 권한
   * @param startDate - 일시정지 시작일
   * @param endDate - 일시정지 종료일
   * @param reason - 일시정지 사유
   */
  async startPause(
    userId: string,
    entitlement: any,
    startDate: Date,
    endDate: Date,
    reason?: string,
  ): Promise<PauseResult> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      const now = new Date();

      // 1. 이벤트 배치 생성
      const [eventBatch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_PAUSED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 일시정지 기간 계산
      const pauseDurationDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      // 3. 기존 권한 종료일에 일시정지 기간만큼 연장
      const originalEndsAt = new Date(entitlement.endsAt);
      const adjustedEndsAt = addDays(originalEndsAt, pauseDurationDays);

      // 4. pause_events 레코드 생성
      const [pauseEvent] = await tx
        .insert(schema.pauseEvents)
        .values({
          userId,
          entitlementId: entitlement.id,
          eventType: 'START',
          effectiveAt: now,
          reason,
        })
        .returning();

      // 5. pause_event_details 레코드 생성 (권한 조정 추적)
      await tx.insert(schema.pauseEventDetails).values({
        pauseEventId: pauseEvent.id,
        userId,
        entitlementId: entitlement.id,
        adjustmentDays: pauseDurationDays,
        startsAt: startDate.toISOString().split('T')[0],
        endsAt: endDate.toISOString().split('T')[0],
      });

      // 6. 기존 entitlement 닫기
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: now,
          closedBatchId: eventBatch.id,
        })
        .where(eq(schema.subscriptionEntitlement.id, entitlement.id));

      // 7. 새로운 entitlement 생성 (일시정지 상태 + 연장된 종료일)
      await tx.insert(schema.subscriptionEntitlement).values({
        userId,
        tierId: entitlement.tierId,
        startsAt: entitlement.startsAt,
        endsAt: adjustedEndsAt.toISOString().split('T')[0],
        isCurrent: true,
        sourceBatchId: eventBatch.id,
        pausedAt: now,
      });

      return {
        pauseEventId: pauseEvent.id,
        adjustedEndsAt: adjustedEndsAt.toISOString().split('T')[0],
        pauseDurationDays,
      };
    });
  }

  /**
   * 구독 일시정지 재개
   *
   * @param userId - 사용자 ID
   * @param entitlement - 현재 일시정지된 권한
   */
  async resumePause(userId: string, entitlement: any): Promise<ResumeResult> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      const now = new Date();

      // 1. 이벤트 배치 생성
      const [eventBatch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_RESUMED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 기존 entitlement 닫기
      await tx
        .update(schema.subscriptionEntitlement)
        .set({
          isCurrent: false,
          closedAt: now,
          closedBatchId: eventBatch.id,
        })
        .where(eq(schema.subscriptionEntitlement.id, entitlement.id));

      // 3. 새로운 entitlement 생성 (일시정지 해제)
      await tx.insert(schema.subscriptionEntitlement).values({
        userId,
        tierId: entitlement.tierId,
        startsAt: entitlement.startsAt,
        endsAt: entitlement.endsAt, // 종료일은 이미 일시정지 시 연장됨
        isCurrent: true,
        sourceBatchId: eventBatch.id,
        pausedAt: null, // 일시정지 해제
      });

      // 4. pause_events에 RESUME 이벤트 기록
      const [resumeEvent] = await tx
        .insert(schema.pauseEvents)
        .values({
          userId,
          entitlementId: entitlement.id,
          eventType: 'RESUME',
          effectiveAt: now,
          reason: 'User resumed subscription',
        })
        .returning();

      return {
        resumeEventId: resumeEvent.id,
        endsAt: entitlement.endsAt,
      };
    });
  }
}
