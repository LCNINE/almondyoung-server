import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import {
  SubscriptionNotFoundException,
  SubscriptionPausedException,
  PauseQuotaExceededException,
  PolicyViolationException,
} from '../shared/exceptions/subscription.exceptions';
// TODO: Uncomment when event publishing is implemented
// import { EventPublisherService } from '@app/events';
import { addDays, differenceInDays } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import type {
  PauseSubscriptionInput,
  ResumeSubscriptionInput,
  PauseHistoryItem,
  PauseEligibilityResponse,
} from '../shared/schemas';


@Injectable()
export class PauseService {
  constructor(
    private readonly dbService: DbService<typeof schema>,
    // TODO: Implement event publishing when external event system is ready
    // private readonly eventPublisher: EventPublisherService,
  ) { }

  /**
   * 구독 일시정지
   */
  async pauseSubscription(
    userId: string,
    pauseRequest: PauseSubscriptionInput,
  ) {
    const result = await this.dbService.db.transaction(async (tx) => {
      // 1. 현재 활성 구독 확인
      const activeSubscription = await this.getActiveSubscription(tx, userId);
      if (!activeSubscription) {
        throw new SubscriptionNotFoundException();
      }

      // 2. 이미 일시정지 중인지 확인
      if (activeSubscription.activeRight?.pausedAt) {
        throw new SubscriptionPausedException('이미 일시정지 중입니다');
      }

      // 3. 일시정지 자격 확인
      const currentYear = new Date().getFullYear();
      const eligibility = await this.checkPauseEligibility(
        tx,
        userId,
        currentYear,
      );
      if (!eligibility.eligible) {
        throw new PauseQuotaExceededException(
          eligibility.currentUsage,
          eligibility.maxPauses,
        );
      }

      // 4. 일시정지 기간 검증
      const startDate = new Date(pauseRequest.startDate);
      const endDate = new Date(pauseRequest.endDate);
      const pauseDays = differenceInDays(endDate, startDate);

      await this.validatePauseDuration(pauseDays);

      // 5. 일시정지 레코드 생성
      const pauseId = uuidv4();
      await tx.insert(schema.subscriptionPauses).values({
        id: pauseId,
        userId,
        subscriptionId: activeSubscription.subscription.id,
        startsAt: startDate.toISOString().split('T')[0], // YYYY-MM-DD 형식으로 변환
        endsAt: endDate.toISOString().split('T')[0], // YYYY-MM-DD 형식으로 변환
        status: 'ACTIVE',
      });

      // 6. 활성 권한 일시정지 처리
      const affectedRights = await this.pauseActiveRights(
        tx,
        userId,
        pauseId,
        startDate,
        endDate,
      );

      // 7. 일시정지 사용량 추적 업데이트
      await this.updatePauseUsageTracker(tx, userId, currentYear, pauseDays);

      // 8. 이벤트 기록
      const eventId = uuidv4();
      const eventPayload = {
        pauseId,
        startDate: pauseRequest.startDate,
        endDate: pauseRequest.endDate,
        reason: pauseRequest.reason,
        affectedRightsCount: affectedRights.length,
        pauseDays,
      };

      await tx.insert(schema.subscriptionEvents).values({
        id: eventId,
        eventType: 'SUBSCRIPTION_PAUSED',
        userId,
        subscriptionId: activeSubscription.subscription.id,
        effectiveDate: startDate.toISOString().split('T')[0], // YYYY-MM-DD 형식으로 변환
        eventPayload,
      });

      return {
        pauseId,
        startDate: pauseRequest.startDate,
        endDate: pauseRequest.endDate,
        affectedRightsCount: affectedRights.length,
        remainingPauseQuota: eligibility.remainingPauses - 1,
        eventPayload,
      };
    });

    // 9. 외부 이벤트 발행 (트랜잭션 외부에서)
    // await this.eventPublisher.publishEvent('subscription.paused', {
    //   userId,
    //   ...result.eventPayload,
    // });

    return result;
  }

  /**
   * 구독 재개
   */
  async resumeSubscription(
    userId: string,
    resumeInput?: ResumeSubscriptionInput,
  ) {
    const result = await this.dbService.db.transaction(async (tx) => {
      // 1. 현재 활성 일시정지 확인
      const activePause = await this.getActivePause(tx, userId);
      if (!activePause) {
        throw new SubscriptionNotFoundException();
      }

      // 2. 일시정지 상태 업데이트
      const resumeDate = new Date();
      await tx
        .update(schema.subscriptionPauses)
        .set({
          status: 'ENDED',
          actualResumedAt: resumeDate.toISOString().split('T')[0],
        })
        .where(eq(schema.subscriptionPauses.id, activePause.id));

      // 3. 권한 복원 및 종료일 연장
      const extensionDays = await this.resumeRightsAndCalculateExtension(
        tx,
        activePause.id,
        resumeDate,
      );

      // 4. 이벤트 기록
      const eventId = uuidv4();
      const eventPayload = {
        pauseId: activePause.id,
        originalEndDate: activePause.endsAt,
        actualResumedDate: resumeDate.toISOString().split('T')[0],
        extensionDays,
        reason: resumeInput?.reason,
      };

      await tx.insert(schema.subscriptionEvents).values({
        id: eventId,
        eventType: 'SUBSCRIPTION_RESUMED',
        userId,
        subscriptionId: activePause.subscriptionId,
        effectiveDate: resumeDate.toISOString().split('T')[0],
        eventPayload,
      });

      return {
        resumedAt: resumeDate,
        extensionDays,
        newEndDate: addDays(resumeDate, extensionDays)
          .toISOString()
          .split('T')[0],
        eventPayload,
      };
    });

    // 5. 외부 이벤트 발행 (트랜잭션 외부에서)
    // await this.eventPublisher.publishEvent('subscription.resumed', {
    //   userId,
    //   ...result.eventPayload,
    // });

    return result;
  }

  /**
   * 일시정지 이력 조회
   */
  async getPauseHistory(userId: string): Promise<PauseHistoryItem[]> {
    const history = await this.dbService.db
      .select()
      .from(schema.subscriptionPauses)
      .where(eq(schema.subscriptionPauses.userId, userId))
      .orderBy(schema.subscriptionPauses.createdAt);

    return history.map((pause) => ({
      id: pause.id,
      startsAt: pause.startsAt,
      endsAt: pause.endsAt,
      actualResumedAt: pause.actualResumedAt,
      status: pause.status,
      createdAt: pause.createdAt.toISOString(),
    }));
  }

  /**
   * 일시정지 자격 확인
   */
  async checkPauseEligibility(
    tx: any, // TODO: Replace with DatabaseTransaction when type issues are resolved
    userId: string,
    year: number,
  ): Promise<PauseEligibilityResponse> {
    // 연간 일시정지 사용량 조회
    const usage = await tx
      .select()
      .from(schema.pauseUsageTracker)
      .where(
        and(
          eq(schema.pauseUsageTracker.userId, userId),
          eq(schema.pauseUsageTracker.year, year),
        ),
      )
      .limit(1);

    const currentUsage = usage[0]?.pauseCount || 0;

    // 정책 조회
    const policies = await tx
      .select()
      .from(schema.subscriptionPolicies)
      .where(
        and(
          eq(schema.subscriptionPolicies.ruleType, 'MAX_PAUSES_PER_YEAR'),
          eq(schema.subscriptionPolicies.isActive, true),
        ),
      );

    const DEFAULT_MAX_PAUSES_PER_YEAR = 2;
    const maxPauses =
      policies[0]?.ruleValue?.limit || DEFAULT_MAX_PAUSES_PER_YEAR;

    return {
      eligible: currentUsage < maxPauses,
      currentUsage,
      maxPauses,
      remainingPauses: maxPauses - currentUsage,
    };
  }

  /**
   * 활성 구독 조회
   */
  private async getActiveSubscription(tx: any, userId: string) {
    const result = await tx
      .select({
        subscription: schema.subscriptions,
        plan: schema.subscriptionPlans,
        tier: schema.subscriptionTiers,
        activeRight: schema.subscriptionRights,
      })
      .from(schema.subscriptions)
      .innerJoin(
        schema.subscriptionPlans,
        eq(schema.subscriptions.planId, schema.subscriptionPlans.id),
      )
      .innerJoin(
        schema.subscriptionTiers,
        eq(schema.subscriptionPlans.tierId, schema.subscriptionTiers.id),
      )
      .leftJoin(
        schema.subscriptionRights,
        and(
          eq(schema.subscriptionRights.subscriptionId, schema.subscriptions.id),
          eq(schema.subscriptionRights.isActive, true),
        ),
      )
      .where(
        and(
          eq(schema.subscriptions.userId, userId),
          eq(schema.subscriptions.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * 활성 일시정지 조회
   */
  private async getActivePause(tx: any, userId: string) {
    const result = await tx
      .select()
      .from(schema.subscriptionPauses)
      .where(
        and(
          eq(schema.subscriptionPauses.userId, userId),
          eq(schema.subscriptionPauses.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * 일시정지 기간 검증
   */
  private async validatePauseDuration(pauseDays: number) {
    // 최소 일시정지 기간 정책 확인
    const policies = await this.dbService.db
      .select()
      .from(schema.subscriptionPolicies)
      .where(
        and(
          eq(schema.subscriptionPolicies.ruleType, 'MIN_PAUSE_DURATION_DAYS'),
          eq(schema.subscriptionPolicies.isActive, true),
        ),
      );

    const DEFAULT_MIN_PAUSE_DAYS = 7;
    const minDays =
      (policies[0]?.ruleValue as any)?.minDays || DEFAULT_MIN_PAUSE_DAYS;

    if (pauseDays < minDays) {
      throw new PolicyViolationException(
        'MIN_PAUSE_DURATION_DAYS',
        `최소 ${minDays}일 이상 일시정지해야 합니다`,
      );
    }
  }

  /**
   * 활성 권한 일시정지 처리
   */
  private async pauseActiveRights(
    tx: any,
    userId: string,
    pauseId: string,
    startDate: Date,
    endDate: Date,
  ) {
    // 활성 권한 조회
    const activeRights = await tx
      .select()
      .from(schema.subscriptionRights)
      .where(
        and(
          eq(schema.subscriptionRights.userId, userId),
          eq(schema.subscriptionRights.isActive, true),
        ),
      );

    const affectedRights: any[] = [];

    for (const right of activeRights) {
      // 권한 일시정지 처리
      await tx
        .update(schema.subscriptionRights)
        .set({
          pausedAt: startDate, // timestamp 타입이므로 Date 객체 그대로 사용
        })
        .where(eq(schema.subscriptionRights.id, right.id));

      // 일시정지 영향 기록
      await tx.insert(schema.pauseAffectedRights).values({
        id: uuidv4(),
        pauseId,
        rightId: right.id,
        originalEndsAt: right.endsAt, // 이미 YYYY-MM-DD 형식의 문자열
        adjustedEndsAt: addDays(
          new Date(right.endsAt),
          differenceInDays(endDate, startDate),
        )
          .toISOString()
          .split('T')[0], // YYYY-MM-DD 형식으로 변환
      });

      affectedRights.push(right);
    }

    return affectedRights;
  }

  /**
   * 권한 복원 및 종료일 연장 계산
   */
  private async resumeRightsAndCalculateExtension(
    tx: any,
    pauseId: string,
    resumeDate: Date,
  ) {
    // 일시정지 영향받은 권한들 조회
    const affectedRights = await tx
      .select({
        pauseAffected: schema.pauseAffectedRights,
        right: schema.subscriptionRights,
      })
      .from(schema.pauseAffectedRights)
      .innerJoin(
        schema.subscriptionRights,
        eq(schema.pauseAffectedRights.rightId, schema.subscriptionRights.id),
      )
      .where(eq(schema.pauseAffectedRights.pauseId, pauseId));

    let totalExtensionDays = 0;

    for (const { pauseAffected, right } of affectedRights) {
      // 권한 재개 처리
      await tx
        .update(schema.subscriptionRights)
        .set({
          pausedAt: null,
          endsAt: pauseAffected.adjustedEndsAt,
        })
        .where(eq(schema.subscriptionRights.id, right.id));

      // 연장 일수 계산
      const extensionDays = differenceInDays(
        new Date(pauseAffected.adjustedEndsAt),
        new Date(pauseAffected.originalEndsAt),
      );
      totalExtensionDays = Math.max(totalExtensionDays, extensionDays);
    }

    return totalExtensionDays;
  }

  /**
   * 일시정지 사용량 추적 업데이트
   */
  private async updatePauseUsageTracker(
    tx: any,
    userId: string,
    year: number,
    pauseDays: number,
  ) {
    // 기존 추적 레코드 조회
    const existing = await tx
      .select()
      .from(schema.pauseUsageTracker)
      .where(
        and(
          eq(schema.pauseUsageTracker.userId, userId),
          eq(schema.pauseUsageTracker.year, year),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // 기존 레코드 업데이트
      await tx
        .update(schema.pauseUsageTracker)
        .set({
          pauseCount: existing[0].pauseCount + 1,
          totalPausedDays: existing[0].totalPausedDays + pauseDays,
          lastPauseDate: new Date().toISOString().split('T')[0],
          updatedAt: new Date(),
        })
        .where(eq(schema.pauseUsageTracker.id, existing[0].id));
    } else {
      // 새 레코드 생성
      await tx.insert(schema.pauseUsageTracker).values({
        id: uuidv4(),
        userId,
        year,
        pauseCount: 1,
        totalPausedDays: pauseDays,
        lastPauseDate: new Date().toISOString().split('T')[0],
      });
    }
  }
}
