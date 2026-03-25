import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { addDays, differenceInDays } from 'date-fns';
import { DrizzleTransaction } from '../../shared/schemas/types';
import { MembershipPolicyService } from '../membership-policy.service';

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
  private readonly logger = new Logger(PauseManager.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly policyService: MembershipPolicyService,
  ) {}

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
    // 정책 기반 검증
    await this.validatePauseRequest(userId, startDate, endDate, entitlement.tierId);

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
      const pauseDurationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      // 3. 기존 권한 종료일에 일시정지 기간만큼 연장
      const originalEndsAt = new Date(entitlement.endsAt);
      const adjustedEndsAt = addDays(originalEndsAt, pauseDurationDays);

      // 4. 정기결제 연동: Contract의 nextBillingDate도 연장
      const [contract] = await tx
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.userId, userId))
        .limit(1);

      if (contract && contract.nextBillingDate) {
        const originalNextBillingDate = new Date(contract.nextBillingDate);
        const adjustedNextBillingDate = addDays(originalNextBillingDate, pauseDurationDays);

        await tx
          .update(schema.subscriptionContracts)
          .set({
            nextBillingDate: adjustedNextBillingDate.toISOString().split('T')[0],
          })
          .where(eq(schema.subscriptionContracts.id, contract.id));
      }

      // 5. pause_events 레코드 생성
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

      // 6. pause_event_details 레코드 생성 (권한 조정 추적)
      await tx.insert(schema.pauseEventDetails).values({
        pauseEventId: pauseEvent.id,
        userId,
        entitlementId: entitlement.id,
        adjustmentDays: pauseDurationDays,
        startsAt: startDate.toISOString().split('T')[0],
        endsAt: endDate.toISOString().split('T')[0],
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

  /**
   * 일시정지 요청 검증 (정책 기반)
   */
  private async validatePauseRequest(userId: string, startDate: Date, endDate: Date, tierId: string): Promise<void> {
    // 1. 최소/최대 기간 확인
    const minDays = await this.policyService.getNumberPolicy(
      'MIN_PAUSE_DURATION_DAYS',
      'days',
      tierId,
      7, // 기본값: 7일
    );

    const maxDays = await this.policyService.getNumberPolicy(
      'MAX_PAUSE_DURATION_DAYS',
      'days',
      tierId,
      90, // 기본값: 90일
    );

    const pauseDays = differenceInDays(endDate, startDate);

    if (pauseDays < minDays) {
      this.logger.warn('Pause duration too short', {
        userId,
        pauseDays,
        minDays,
      });
      throw new Error(`최소 ${minDays}일 이상 일시정지해야 합니다`);
    }

    if (pauseDays > maxDays) {
      this.logger.warn('Pause duration too long', {
        userId,
        pauseDays,
        maxDays,
      });
      throw new Error(`최대 ${maxDays}일까지만 일시정지 가능합니다`);
    }

    // 2. 블랙아웃 기간 확인
    try {
      const blackoutPolicy = await this.policyService.getPolicyValue<{
        periods?: Array<{
          name: string;
          startDate: string;
          endDate: string;
          reason: string;
        }>;
      }>('PAUSE_BLACKOUT_PERIODS', tierId);

      if (blackoutPolicy?.periods) {
        for (const period of blackoutPolicy.periods) {
          const blackoutStart = new Date(period.startDate);
          const blackoutEnd = new Date(period.endDate);

          if (
            (startDate >= blackoutStart && startDate <= blackoutEnd) ||
            (endDate >= blackoutStart && endDate <= blackoutEnd)
          ) {
            this.logger.warn('Pause request in blackout period', {
              userId,
              period: period.name,
            });
            throw new Error(`${period.name} 기간에는 일시정지할 수 없습니다: ${period.reason}`);
          }
        }
      }
    } catch (error) {
      // 블랙아웃 정책이 없으면 무시
      if (error instanceof Error && error.message.includes('Policy not found')) {
        this.logger.debug('No blackout policy found, skipping check');
      } else {
        throw error;
      }
    }

    // 3. 연간 최대 횟수 확인
    const maxPausesPerYear = await this.policyService.getNumberPolicy(
      'MAX_PAUSES_PER_YEAR',
      'count',
      tierId,
      2, // 기본값: 2회
    );

    const pauseCount = await this.getPauseCountThisYear(userId);

    if (pauseCount >= maxPausesPerYear) {
      this.logger.warn('Max pauses per year exceeded', {
        userId,
        pauseCount,
        maxPausesPerYear,
      });
      throw new Error(`연간 최대 ${maxPausesPerYear}회까지만 일시정지 가능합니다`);
    }

    this.logger.log('Pause request validated', {
      userId,
      pauseDays,
      pauseCount,
    });
  }

  /**
   * 올해 일시정지 횟수 조회
   */
  private async getPauseCountThisYear(userId: string): Promise<number> {
    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    const events = await this.dbService.db
      .select()
      .from(schema.pauseEvents)
      .where(eq(schema.pauseEvents.userId, userId));

    return events.filter((e) => e.eventType === 'START' && e.effectiveAt >= yearStart).length;
  }
}
