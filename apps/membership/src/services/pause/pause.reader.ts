import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, asc, desc, isNull, isNotNull, lte } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';

export interface PauseHistoryItem {
  eventId: string;
  eventType: 'START' | 'RESUME';
  effectiveAt: Date;
  reason: string | null;
  createdAt: Date;
  detailId: string | null;
  adjustmentDays: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * PauseReader (Implementation Layer)
 *
 * 역할: 일시정지 이력 조회
 * - 사용자의 일시정지 이력 조회
 * - 현재 일시정지 상태 조회
 */
@Injectable()
export class PauseReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 특정 시점 이후 실제로 정지돼 있던 일수.
   *
   * 연간 중도해지 정산이 "이용한 기간"을 세는데, 정지 기간에는 혜택을 쓸 수 없으므로 이용으로 세면
   * 안 된다. START~RESUME 을 시간순으로 짝지어 실제 정지 구간만 더한다(아직 재개 전이면 지금까지).
   */
  async sumPausedDaysSince(userId: string, from: Date): Promise<number> {
    const events = await this.dbService.db
      .select({ eventType: schema.pauseEvents.eventType, effectiveAt: schema.pauseEvents.effectiveAt })
      .from(schema.pauseEvents)
      .where(eq(schema.pauseEvents.userId, userId))
      .orderBy(asc(schema.pauseEvents.effectiveAt));

    const now = new Date();
    let pausedSince: Date | null = null;
    let totalMs = 0;

    for (const event of events) {
      if (event.eventType === 'START') {
        pausedSince = event.effectiveAt;
        continue;
      }
      if (event.eventType === 'RESUME' && pausedSince) {
        totalMs += this.overlapMs(pausedSince, event.effectiveAt, from, now);
        pausedSince = null;
      }
    }
    if (pausedSince) totalMs += this.overlapMs(pausedSince, now, from, now);

    return Math.floor(totalMs / (1000 * 60 * 60 * 24));
  }

  /** [start,end) 와 [windowStart,windowEnd) 의 겹치는 시간(ms). 주기 이전의 정지는 세지 않는다. */
  private overlapMs(start: Date, end: Date, windowStart: Date, windowEnd: Date): number {
    const from = Math.max(start.getTime(), windowStart.getTime());
    const to = Math.min(end.getTime(), windowEnd.getTime());
    return Math.max(0, to - from);
  }

  /**
   * 특정 사용자의 모든 일시정지 이력 조회
   */
  async findPauseHistory(userId: string): Promise<PauseHistoryItem[]> {
    const history = await this.dbService.db
      .select({
        eventId: schema.pauseEvents.id,
        eventType: schema.pauseEvents.eventType,
        effectiveAt: schema.pauseEvents.effectiveAt,
        reason: schema.pauseEvents.reason,
        createdAt: schema.pauseEvents.createdAt,
        detailId: schema.pauseEventDetails.id,
        adjustmentDays: schema.pauseEventDetails.adjustmentDays,
        startsAt: schema.pauseEventDetails.startsAt,
        endsAt: schema.pauseEventDetails.endsAt,
      })
      .from(schema.pauseEvents)
      .leftJoin(schema.pauseEventDetails, eq(schema.pauseEvents.id, schema.pauseEventDetails.pauseEventId))
      .where(eq(schema.pauseEvents.userId, userId))
      .orderBy(desc(schema.pauseEvents.createdAt));

    return history;
  }

  /**
   * 현재 일시정지 중인 권한 조회
   */
  async findPausedEntitlement(userId: string) {
    return this.dbService.db.query.subscriptionEntitlement.findFirst({
      where: and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
    });
  }

  /**
   * 자동 재개 대상 조회: 현재 일시정지 중이고 일시정지 종료일이 지난 권한.
   * entitlement.pausedAt(START 시각)과 pause_events.effectiveAt를 매칭해 현재 일시정지의 종료일을 본다.
   */
  async findEntitlementsDueForAutoResume(today: string) {
    return this.dbService.db
      .select({
        id: schema.subscriptionEntitlement.id,
        userId: schema.subscriptionEntitlement.userId,
        tierId: schema.subscriptionEntitlement.tierId,
        startsAt: schema.subscriptionEntitlement.startsAt,
        endsAt: schema.subscriptionEntitlement.endsAt,
        pausedAt: schema.subscriptionEntitlement.pausedAt,
      })
      .from(schema.subscriptionEntitlement)
      .innerJoin(
        schema.pauseEvents,
        and(
          eq(schema.pauseEvents.userId, schema.subscriptionEntitlement.userId),
          eq(schema.pauseEvents.eventType, 'START'),
          eq(schema.pauseEvents.effectiveAt, schema.subscriptionEntitlement.pausedAt),
        ),
      )
      .innerJoin(schema.pauseEventDetails, eq(schema.pauseEventDetails.pauseEventId, schema.pauseEvents.id))
      .where(
        and(
          eq(schema.subscriptionEntitlement.isCurrent, true),
          isNotNull(schema.subscriptionEntitlement.pausedAt),
          lte(schema.pauseEventDetails.endsAt, today),
        ),
      );
  }

  /**
   * 활성 상태이며 일시정지되지 않은 권한 조회
   */
  async findActiveNonPausedEntitlement(userId: string) {
    return this.dbService.db.query.subscriptionEntitlement.findFirst({
      where: and(
        eq(schema.subscriptionEntitlement.userId, userId),
        eq(schema.subscriptionEntitlement.isCurrent, true),
        isNull(schema.subscriptionEntitlement.pausedAt),
      ),
    });
  }
}
