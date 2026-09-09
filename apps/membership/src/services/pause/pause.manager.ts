import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, isNotNull } from 'drizzle-orm';
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

      // 2. 계획된 일시정지 기간(감사/표시용). 실제 종료일 연장은 재개 시 '실제 정지된 일수'로 적용한다.
      // (여기서 미리 연장하면 조기 재개 시 회수하지 못해 무료 연장 익스플로잇이 된다)
      const pauseDurationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      // 3. 종료일은 동결(연장하지 않음). 일시정지 중에는 findDueContracts 가 pausedAt 로 청구를 막으므로
      // nextBillingDate 도 건드리지 않는다 — 재개 시 실제 정지 일수만큼 endsAt·nextBillingDate 를 함께 밀어준다.
      const frozenEndsAt = new Date(entitlement.endsAt);

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

      // 8. 새로운 entitlement 생성 (일시정지 상태 + 동결된 종료일)
      await tx.insert(schema.subscriptionEntitlement).values({
        userId,
        tierId: entitlement.tierId,
        startsAt: entitlement.startsAt,
        endsAt: frozenEndsAt.toISOString().split('T')[0],
        isCurrent: true,
        sourceBatchId: eventBatch.id,
        pausedAt: now,
      });

      return {
        pauseEventId: pauseEvent.id,
        adjustedEndsAt: frozenEndsAt.toISOString().split('T')[0],
        pauseDurationDays,
      };
    });
  }

  /**
   * 구독 일시정지 재개
   *
   * 🔴 **정지 자격을 «조건부로» 선점한 쪽만 재개한다** (#707). 옛 구현은 `entitlement.id` 만 보고
   * 무조건 닫은 뒤 새 자격을 넣었다. `subscription_entitlement` 에는 "유저당 isCurrent 하나" 를
   * 강제하는 제약이 없으므로, 자동 재개 크론이 두 인스턴스에서 겹치면(배포 창) **isCurrent=true 인
   * 자격이 두 벌 생기고** `nextBillingDate` 가 두 번 밀려 한 주기가 통째로 건너뛰어진다.
   * 무해한 통지 중복이 아니라 데이터 손상이라, 여기서 막는다.
   *
   * 선점에 진 호출은 `null` 을 돌려준다 — 이미 다른 실행이 재개를 끝냈다는 뜻이므로 호출자는
   * 이벤트 발행을 건너뛴다. `handleExpiration`(billing-outcome.handler) 이 쓰는 것과 같은 관용구다.
   *
   * @param userId - 사용자 ID
   * @param entitlement - 현재 일시정지된 권한
   * @returns 재개 결과. 이미 다른 실행이 선점했으면 `null`
   */
  async resumePause(userId: string, entitlement: any): Promise<ResumeResult | null> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      const now = new Date();

      // 실제 정지된 일수만큼만 종료일을 연장한다(조기 재개면 그만큼 적게 연장 → 무료 연장 방지).
      const pausedAt = entitlement.pausedAt ? new Date(entitlement.pausedAt) : now;
      const actualPausedDays = Math.max(0, differenceInDays(now, pausedAt));
      const resumedEndsAt = addDays(new Date(entitlement.endsAt), actualPausedDays);

      // 1. 정지 자격 선점 — 아직 «현재이면서 정지 중» 인 행만 닫는다. 0행이면 이미 재개된 것이라
      //    아무것도 쓰지 않고 빠진다. 배치 생성보다 «먼저» 해야 고아 배치가 남지 않는다.
      const [claimed] = await tx
        .update(schema.subscriptionEntitlement)
        .set({ isCurrent: false, closedAt: now })
        .where(
          and(
            eq(schema.subscriptionEntitlement.id, entitlement.id),
            eq(schema.subscriptionEntitlement.isCurrent, true),
            isNotNull(schema.subscriptionEntitlement.pausedAt),
          ),
        )
        .returning({ id: schema.subscriptionEntitlement.id });

      if (!claimed) {
        this.logger.log(`resumePause: 이미 재개됨 — 건너뜀 (userId=${userId}, entitlementId=${entitlement.id})`);
        return null;
      }

      // 2. 이벤트 배치 생성 후 방금 닫은 행에 연결
      const [eventBatch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_RESUMED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      await tx
        .update(schema.subscriptionEntitlement)
        .set({ closedBatchId: eventBatch.id })
        .where(eq(schema.subscriptionEntitlement.id, entitlement.id));

      // 3. 새로운 entitlement 생성 (일시정지 해제 + 실제 정지 일수만큼 연장된 종료일)
      await tx.insert(schema.subscriptionEntitlement).values({
        userId,
        tierId: entitlement.tierId,
        startsAt: entitlement.startsAt,
        endsAt: resumedEndsAt.toISOString().split('T')[0],
        isCurrent: true,
        sourceBatchId: eventBatch.id,
        pausedAt: null, // 일시정지 해제
      });

      // 4. 정기결제 연동: 정지 중 밀린 만큼 nextBillingDate 도 함께 이동(재개 즉시 청구되는 것 방지)
      const [contract] = await tx
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.userId, userId))
        .limit(1);

      if (contract && contract.nextBillingDate && actualPausedDays > 0) {
        const today = now.toISOString().split('T')[0];
        const currentPeriodUnpaid = contract.nextBillingDate <= today;
        // INVOICE 경로에서 현재 주기가 미결(nextBillingDate<=today)이면 nextBillingDate 를 밀지
        // 않는다. 미결 주기는 이미 인보이스가 발행돼 있고, 그 멱등키는 periodStart(=nextBillingDate)
        // 로 만들어졌다. 여기서 shift 하면 다음 스케줄러가 다른 멱등키로 같은 주기에 두 번째
        // 인보이스를 발행해 이중 출금된다. 정지 보상은 entitlement.endsAt(위 3번)에 이미 반영됐고,
        // nextBillingDate 는 invoice.paid 가 미래로 전진시킨 뒤에만(=아래 else) 밀 수 있다.
        const skipShift = contract.billingPath === 'INVOICE' && currentPeriodUnpaid;
        if (!skipShift) {
          const shiftedNextBillingDate = addDays(new Date(contract.nextBillingDate), actualPausedDays);
          await tx
            .update(schema.subscriptionContracts)
            .set({ nextBillingDate: shiftedNextBillingDate.toISOString().split('T')[0] })
            .where(eq(schema.subscriptionContracts.id, contract.id));
        }
      }

      // 5. pause_events에 RESUME 이벤트 기록
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
        endsAt: resumedEndsAt.toISOString().split('T')[0],
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
