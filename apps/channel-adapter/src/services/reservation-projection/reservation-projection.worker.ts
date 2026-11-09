import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DbService } from '@app/db';
import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';
import { eq, lt, sql } from 'drizzle-orm';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { inboxEvents, medusaReservationProjectionVersions } from '../../schema';
import type { ChannelAdapterSchema } from '../../types';
import { CHANNEL_CAPABILITIES } from '../channel-capabilities';
import { withMedusaOrderProjectionLock } from '../medusa-order-projection-lock';
import { ReservationCutoverRepository } from './reservation-cutover.repository';
import { ReservationProjectionService } from './reservation-projection.service';

export const RESERVATION_STATE_EVENT_TYPE = 'SalesOrderLineReservationState';
const WRITE_CHUNK = 200;
const DEFER_MS = 60_000;
/** Medusa 호출 HTTP 타임아웃(120초)보다 길어야 처리 중인 행을 다른 틱이 가로채지 않는다. */
const LEASE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RETRIES = 10;

export type ClaimedReservationEvent = {
  id: string;
  attempts: number;
  payload: SalesOrderLineReservationStatePayload;
};

type Verdict = { kind: 'done' } | { kind: 'defer' } | { kind: 'error'; message: string };

/**
 * `SalesOrderLineReservationState` 를 Medusa 예약에 반영하는 전용 inbox 워커(#1247).
 * `InboxWorkerService` 의 10초 레인을 같이 쓰지 않는다 — 한 번 호출이 최대 120초 걸린다.
 */
@Injectable()
export class ReservationProjectionWorker {
  private readonly logger = new Logger(ReservationProjectionWorker.name);
  private running = false;

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly cutover: ReservationCutoverRepository,
    private readonly projection: ReservationProjectionService,
    private readonly medusaClient: MedusaClient,
  ) {}

  @Interval(1_000)
  async processPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const event = await this.claimNext();
      if (event) await this.processClaimed(event);
    } catch (error) {
      this.logger.error(`예약 투영 워커 틱 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async processClaimed(event: ClaimedReservationEvent): Promise<void> {
    let verdict: Verdict;
    try {
      verdict = await this.apply(event.payload);
    } catch (error) {
      verdict = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }

    if (verdict.kind === 'done') {
      await this.dbService.db
        .update(inboxEvents)
        .set({ status: 'published', publishedAt: new Date(), errorMessage: null })
        .where(eq(inboxEvents.id, event.id));
    } else if (verdict.kind === 'defer') {
      // 기다림은 실패가 아니다 — claim 이 올린 attempts 를 되돌린다(크래시·멈춤은 되돌려지지 않아 센다).
      await this.dbService.db
        .update(inboxEvents)
        .set({
          status: 'pending',
          attempts: Math.max(0, event.attempts - 1),
          nextAttemptAt: new Date(Date.now() + DEFER_MS),
          errorMessage: 'deferred: 재고 정착 대기',
        })
        .where(eq(inboxEvents.id, event.id));
    } else {
      const attempts = event.attempts; // claim 이 이미 올렸다
      const exhausted = attempts >= this.maxRetries();
      await this.dbService.db
        .update(inboxEvents)
        .set(
          exhausted
            ? { status: 'failed', attempts, failedAt: new Date(), errorMessage: verdict.message }
            : {
                status: 'pending',
                attempts,
                nextAttemptAt: new Date(Date.now() + this.backoffMs(attempts)),
                errorMessage: verdict.message,
              },
        )
        .where(eq(inboxEvents.id, event.id));
      this.logger.warn(`예약 투영 실패(${attempts}/${this.maxRetries()}): ${verdict.message}`);
    }
  }

  private async apply(payload: SalesOrderLineReservationStatePayload): Promise<Verdict> {
    const cutoverAt = await this.cutover.get();
    if (!cutoverAt) return { kind: 'done' };
    if (new Date(payload.orderedAt).getTime() < cutoverAt.getTime()) return { kind: 'done' };

    const capability = CHANNEL_CAPABILITIES[payload.salesChannel];
    if (!capability || capability.integration !== 'api' || capability.reservation.kind !== 'projection') {
      return { kind: 'done' };
    }

    // 같은 주문의 두 버전이 다른 태스크에서 겹쳐 순서가 뒤집히지 않게 주문 단위로 직렬화한다.
    // 키는 Medusa 주문 metadata 투영(`orderId` 그대로)과 겹치지 않게 접두사를 단다.
    return withMedusaOrderProjectionLock(this.dbService, `reservation:${payload.salesOrderId}`, () =>
      this.applyLocked(payload),
    );
  }

  private async applyLocked(payload: SalesOrderLineReservationStatePayload): Promise<Verdict> {
    const [applied] = await this.dbService.db
      .select({ appliedVersion: medusaReservationProjectionVersions.appliedVersion })
      .from(medusaReservationProjectionVersions)
      .where(eq(medusaReservationProjectionVersions.salesOrderId, payload.salesOrderId))
      .limit(1);
    if (applied && payload.version <= applied.appliedVersion) return { kind: 'done' };

    const writes = await this.projection.toWrites(payload.lines, new Date(payload.asOf), new Date());
    let deferred = false;
    const errors: string[] = [];
    for (let i = 0; i < writes.length; i += WRITE_CHUNK) {
      const results = await this.medusaClient.setLineItemReservations(writes.slice(i, i + WRITE_CHUNK));
      for (const result of results) {
        if (result.outcome === 'deferred') deferred = true;
        if (result.outcome === 'error') errors.push(`${result.lineItemId}: ${result.message ?? 'error'}`);
      }
    }
    if (errors.length > 0) return { kind: 'error', message: errors.slice(0, 5).join('; ') };
    if (deferred) return { kind: 'defer' };

    await this.bumpVersion(payload.salesOrderId, payload.version);
    return { kind: 'done' };
  }

  /** 더 큰 버전일 때만 올린다 — 겹친 옛 쓰기가 앞선 버전을 되돌리지 못하게. */
  async bumpVersion(salesOrderId: string, version: number): Promise<void> {
    const appliedAt = new Date();
    await this.dbService.db
      .insert(medusaReservationProjectionVersions)
      .values({ salesOrderId, appliedVersion: version, appliedAt })
      .onConflictDoUpdate({
        target: medusaReservationProjectionVersions.salesOrderId,
        set: { appliedVersion: version, appliedAt },
        setWhere: lt(medusaReservationProjectionVersions.appliedVersion, version),
      });
  }

  private maxRetries(): number {
    const parsed = Number.parseInt(process.env.RESERVATION_PROJECTION_MAX_RETRIES ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RETRIES;
  }

  private backoffMs(attempts: number): number {
    return Math.min(5_000 * 2 ** (attempts - 1), 5 * 60_000);
  }

  /** 통합 스펙이 구동한다. attempts 를 올려 크래시·멈춤 루프가 상한에 닿게 한다. */
  async claimNext(): Promise<ClaimedReservationEvent | null> {
    const rows = await this.dbService.db.execute<ClaimedReservationEvent>(sql`
      UPDATE ${inboxEvents}
      SET
        status = 'processing',
        attempts = attempts + 1,
        next_attempt_at = NOW() + (${LEASE_MS}::integer * interval '1 millisecond'),
        error_message = NULL
      WHERE id = (
        SELECT id
        FROM ${inboxEvents}
        WHERE event_type = ${RESERVATION_STATE_EVENT_TYPE}
          AND status IN ('pending', 'processing')
          AND next_attempt_at <= NOW()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, attempts, payload
    `);
    return rows[0] ?? null;
  }
}
