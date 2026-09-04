import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { inboxEvents } from '../schema';
import { MedusaClient } from '../adapters/medusa/medusa.client';
import type { ChannelAdapterSchema } from '../types';
import {
  recordCouponIssueBacklog,
  COUPON_TRIGGER_EVENT_TYPES,
} from '../observability/coupon-issue.metrics';

/**
 * 빠른 레인이 이 이벤트를 이미 한 번 되살렸다는 표시.
 *
 * `inbox_events.metadata`(jsonb, nullable)에 쓴다 — 마이그레이션 없이 «1회» 를 표현할 수 있는
 * 유일한 자리다. 이게 없으면 영구 실패가 15분마다 재시도 사다리를 다시 타 1 vCPU Medusa 를
 * 하루 96회 두드린다. 두 번째부터는 03:00 크론(느린 백스톱)이 맡는다.
 */
const FAST_LANE_MARKER = 'coupon_fast_reset';

/** 빠른 레인의 대상 창. 그보다 오래된 실패는 급하지 않고, 03:00 크론이 더 넓은 창으로 본다. */
const FAST_LANE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// MembershipStatusChanged: short window — transient failures requeue via resetToPending
const LOOKBACK_MS_MEMBERSHIP = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CouponIssueReconciliationService {
  private readonly logger = new Logger(CouponIssueReconciliationService.name);

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly medusaClient: MedusaClient,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'Asia/Seoul' })
  async reconcile(): Promise<void> {
    await this.run();
  }

  async runManually(): Promise<{ reset: number; skipped: number }> {
    return this.run();
  }

  /**
   * 최근 실패를 «한 번» 즉시 되살린다 (#488 `7-2`).
   *
   * 왜 필요한가: `MembershipStatusChanged` 는 재시도 5회(2·4·8·16초)를 태우면 `failed` 가 되고,
   * 그 뒤 재구동은 03:00 크론뿐이었다 — Medusa 가 1분 넘게 아프면 멤버십 쿠폰이 **다음날까지**
   * 밀린다. 여기서 그 창이 15분이 된다.
   *
   * 왜 «한 번» 인가: 위 FAST_LANE_MARKER 주석 참조.
   *
   * `processing` 에 낀 행은 여기서 다루지 않는다 — 워커의 클레임 술어가 리스 만료된
   * `processing` 을 이미 다시 물어간다(`inbox-worker.service.ts` 의 claim SQL). #488 `7-2` 의
   * 「pending/processing 은 리컨실 대상도 아님」은 그 절반이 이미 워커에 있다.
   */
  @Cron('*/15 * * * *', { timeZone: 'Asia/Seoul' })
  async sweepRecentFailures(): Promise<void> {
    const since = new Date(Date.now() - FAST_LANE_LOOKBACK_MS);

    const revived = await this.dbService.db
      .update(inboxEvents)
      .set({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        errorMessage: null,
        failedAt: null,
        // 🔴 `::text` 캐스트가 필수다. `jsonb_build_object` 는 `any` 를 받아서 바인딩
        // 파라미터의 타입을 추론하지 못하고 `could not determine data type of parameter $1`
        // 로 죽는다 — 목으로는 조용히 통과하고 실 DB 에서만 드러난다(2026-09-01 실측).
        metadata: sql`coalesce(${inboxEvents.metadata}, '{}'::jsonb) || jsonb_build_object(${FAST_LANE_MARKER}::text, now())`,
      })
      .where(
        and(
          eq(inboxEvents.status, 'failed'),
          inArray(inboxEvents.eventType, [...COUPON_TRIGGER_EVENT_TYPES]),
          gte(inboxEvents.failedAt, since),
          // `metadata` 가 NULL 이어도, 키가 없어도 NULL 이라 둘 다 여기 걸린다.
          // `->` 는 (jsonb, int) 와 (jsonb, text) 두 오버로드가 있어 캐스트 없이는 모호하다.
          sql`${inboxEvents.metadata} -> ${FAST_LANE_MARKER}::text is null`,
        ),
      )
      .returning({ id: inboxEvents.id });

    if (revived.length > 0) {
      this.logger.warn(`쿠폰 발급 실패 ${revived.length}건을 즉시 재시도 큐로 되돌렸다 (빠른 레인)`);
    }

    await this.refreshBacklogGauge();
  }

  /**
   * `failed` 로 남은 발급 트리거 행 수를 게이지에 적는다 (#488 `7-4`).
   * 되살린 게 없어도 부른다 — 해소된 뒤 게이지가 안 내려가면 알림이 영원히 켜져 있다.
   */
  private async refreshBacklogGauge(): Promise<void> {
    const rows = await this.dbService.db
      .select({ eventType: inboxEvents.eventType, count: sql<number>`count(*)::int` })
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.status, 'failed'),
          inArray(inboxEvents.eventType, [...COUPON_TRIGGER_EVENT_TYPES]),
        ),
      )
      .groupBy(inboxEvents.eventType);

    recordCouponIssueBacklog(rows.map((r) => ({ eventType: r.eventType, count: Number(r.count) })));
  }

  private async run(): Promise<{ reset: number; skipped: number }> {
    this.logger.log('쿠폰 자동 발급 보정 시작');

    // MembershipStatusChanged 만 본다. customer_registered 는 Medusa 안(`customer.created` subscriber)에서
    // 발화하고 inbox 를 지나지 않는다 (#775) — 그쪽 실패는 Medusa 의 카운터·로그가 보인다.
    const since = new Date(Date.now() - LOOKBACK_MS_MEMBERSHIP);
    const failed = await this.dbService.db
      .select()
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.status, 'failed'),
          inArray(inboxEvents.eventType, [...COUPON_TRIGGER_EVENT_TYPES]),
          gte(inboxEvents.createdAt, since),
        ),
      );

    if (failed.length === 0) {
      this.logger.log('보정 대상 없음');
      await this.refreshBacklogGauge();
      return { reset: 0, skipped: 0 };
    }

    this.logger.log(`보정 대상 ${failed.length}건 발견`);
    let reset = 0;
    let skipped = 0;

    for (const event of failed) {
      try {
        // 원인이 일시적 오류일 가능성이 높으므로 재대기 — 워커가 다시 물어간다.
        await this.resetToPending(event.id);
        reset++;
      } catch (err) {
        this.logger.error(`보정 실패 (eventId=${event.id}, type=${event.eventType}): ${(err as any)?.message}`);
        skipped++;
      }
    }

    await this.refreshBacklogGauge();
    this.logger.log(`쿠폰 발급 보정 완료: reset=${reset}, skipped=${skipped}`);
    return { reset, skipped };
  }

  private async resetToPending(eventId: string): Promise<void> {
    await this.dbService.db
      .update(inboxEvents)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), errorMessage: null })
      .where(eq(inboxEvents.id, eventId));
  }
}
