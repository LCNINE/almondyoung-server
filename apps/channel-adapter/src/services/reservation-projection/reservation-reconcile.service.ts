import { Injectable, Logger } from '@nestjs/common';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { CHANNEL_CAPABILITIES } from '../channel-capabilities';
import { CORE_LINE_STATE_BATCH, CoreLineReservationStateClient } from '../clients/core-line-reservation-state.client';
import type { CoreLineReservationState } from '../clients/core-line-reservation-state.client';
import { ReservationCutoverRepository } from './reservation-cutover.repository';
import { ReservationProjectionService } from './reservation-projection.service';
import { ReservationReconcileRunRepository } from './reservation-reconcile-run.repository';
import type { ReconcileExample, ReconcileRunResult } from './reservation-reconcile-run.repository';

const CHANNEL = 'medusa' as const;
const MEDUSA_PAGE = 500;
const WRITE_CHUNK = 200;
const EXAMPLE_LIMIT = 10;
const CORE_WINDOW_MS = 30 * 24 * 3600 * 1000;
/**
 * 대사는 방금 읽은 상태를 그 자리에서 쓴다 — 이벤트 소비자처럼 스냅샷 나이로 «정착 지연» 을 판정하면 감소가 영영 막힌다.
 * 그래서 asOf 를 충분히 옛값으로 주고 «처리 전 ProductSellableQuantityChanged inbox 행» 검사만 쓴다.
 */
const GATE_AS_OF_LAG_MS = 3600 * 1000;

export type ReconcileRunRecord = ReconcileRunResult & { id: string | null };

@Injectable()
export class ReservationReconcileService {
  private readonly logger = new Logger(ReservationReconcileService.name);

  constructor(
    private readonly cutover: ReservationCutoverRepository,
    private readonly medusaClient: MedusaClient,
    private readonly coreClient: CoreLineReservationStateClient,
    private readonly projection: ReservationProjectionService,
    private readonly runs: ReservationReconcileRunRepository,
  ) {}

  /** `limit: null` 은 «확인했으니 고치기» — 한도를 무시하고 처리자를 남긴다. */
  async run(opts: { limit: number | null; forcedBy?: string }): Promise<ReconcileRunRecord> {
    const cutoverAt = await this.cutover.get();
    const capability = CHANNEL_CAPABILITIES[CHANNEL];
    if (!cutoverAt || capability?.integration !== 'api' || capability.reservation.kind !== 'projection') {
      return { id: null, ...emptyResult('skipped') };
    }
    const now = new Date();
    const id = await this.runs.start(now, opts.forcedBy ?? null);
    let result: ReconcileRunResult;
    try {
      result = await this.reconcile(cutoverAt, now, opts.limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`예약 대사 건너뜀: ${message}`);
      result = { ...emptyResult('skipped'), error: message.slice(0, 1000) };
    }
    await this.runs.finish(id, result);
    return { id, ...result };
  }

  private async reconcile(cutoverAt: Date, now: Date, limit: number | null): Promise<ReconcileRunResult> {
    // 1) 전부 모은다 — 쓰기는 그 뒤. 읽기 하나라도 던지면 호출부가 회차를 건너뛴다(쓰기 0).
    const medusaQty = new Map<string, number>();
    const medusaCreatedAt = new Map<string, Date>();
    let afterId: string | undefined;
    for (;;) {
      const page = await this.medusaClient.listLineItemReservations({
        orderCreatedFrom: cutoverAt,
        afterId,
        limit: MEDUSA_PAGE,
      });
      for (const r of page.reservations) {
        medusaQty.set(r.lineItemId, (medusaQty.get(r.lineItemId) ?? 0) + r.quantity);
        const prev = medusaCreatedAt.get(r.lineItemId);
        if (!prev || r.orderCreatedAt < prev) medusaCreatedAt.set(r.lineItemId, r.orderCreatedAt);
      }
      if (!page.nextAfterId) break;
      afterId = page.nextAfterId;
    }

    const coreFrom = new Date(Math.max(cutoverAt.getTime(), now.getTime() - CORE_WINDOW_MS));
    const coreIds = await this.coreClient.candidates(CHANNEL, coreFrom);
    const candidateIds = [...new Set([...medusaQty.keys(), ...coreIds])];

    const lines: CoreLineReservationState[] = [];
    const unknownIds = new Set<string>();
    for (let i = 0; i < candidateIds.length; i += CORE_LINE_STATE_BATCH) {
      const res = await this.coreClient.states(CHANNEL, candidateIds.slice(i, i + CORE_LINE_STATE_BATCH));
      lines.push(...res.lines);
      for (const u of res.unknown) unknownIds.add(u);
    }

    let oldestUnknownAt: Date | null = null;
    for (const u of unknownIds) {
      const at = medusaCreatedAt.get(u);
      if (at && (!oldestUnknownAt || at < oldestUnknownAt)) oldestUnknownAt = at;
    }

    // T 이전 주문은 끝까지 건드리지 않는다.
    const eligible = lines.filter((l) => new Date(l.orderedAt).getTime() >= cutoverAt.getTime());
    const writes = await this.projection.toWrites(eligible, new Date(now.getTime() - GATE_AS_OF_LAG_MS), now);
    const diffs = writes
      .map((w) => ({ ...w, current: medusaQty.get(w.lineItemId) ?? 0 }))
      .filter((w) => w.quantity !== w.current);

    // 2) 한도 판정 — 어차피 deferred 될 줄(목표 < 현재, 게이트가 막음)은 세지 않는다.
    const counted = diffs.filter((w) => !(w.quantity < w.current && !w.allowDecrease));
    const base = { candidates: candidateIds.length, unknown: unknownIds.size, oldestUnknownAt };
    if (limit !== null && counted.length > limit) {
      const examples: ReconcileExample[] = counted
        .slice(0, EXAMPLE_LIMIT)
        .map((w) => ({ lineItemId: w.lineItemId, current: w.current, target: w.quantity }));
      return { ...emptyResult('halted'), ...base, examples };
    }

    // 3) 쓰기 — 묶음이 던지면 그 묶음 줄을 실패로 세고 다음 묶음으로.
    let fixes = 0;
    let fixFailures = 0;
    let deferred = 0;
    for (let i = 0; i < diffs.length; i += WRITE_CHUNK) {
      const chunk = diffs.slice(i, i + WRITE_CHUNK);
      try {
        const results = await this.medusaClient.setLineItemReservations(
          chunk.map(({ lineItemId, quantity, allowDecrease }) => ({ lineItemId, quantity, allowDecrease })),
        );
        for (const r of results) {
          if (r.outcome === 'set') fixes += 1;
          else if (r.outcome === 'error') fixFailures += 1;
          else if (r.outcome === 'deferred') deferred += 1;
        }
      } catch (error) {
        fixFailures += chunk.length;
        this.logger.warn(`예약 대사 쓰기 묶음 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { ...emptyResult('applied'), ...base, fixes, fixFailures, deferred };
  }
}

function emptyResult(status: ReconcileRunResult['status']): ReconcileRunResult {
  return {
    status,
    candidates: 0,
    fixes: 0,
    fixFailures: 0,
    deferred: 0,
    unknown: 0,
    oldestUnknownAt: null,
    examples: [],
    error: null,
  };
}
