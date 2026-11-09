import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MedusaClient, type LineItemReservationResult } from '../../adapters/medusa/medusa.client';
import { CHANNEL_CAPABILITIES } from '../channel-capabilities';
import { CORE_LINE_STATE_BATCH, CoreLineReservationStateClient } from '../clients/core-line-reservation-state.client';
import type { CoreLineReservationState } from '../clients/core-line-reservation-state.client';
import { ReservationCutoverRepository } from './reservation-cutover.repository';
import { ReservationProjectionService } from './reservation-projection.service';
import { ReservationReconcileRunRepository } from './reservation-reconcile-run.repository';
import { reservationTarget } from './reservation-target';
import type { ReconcileExample, ReconcileRunResult } from './reservation-reconcile-run.repository';

const CHANNEL = 'medusa' as const;
const MEDUSA_PAGE = 500;
const WRITE_CHUNK = 200;
const EXAMPLE_LIMIT = 10;
const CORE_WINDOW_MS = 30 * 24 * 3600 * 1000;
const DEFAULT_SETTLE_MS = 300000;

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
    configService: ConfigService,
  ) {
    // 게이트(SellableSettleGate)와 같은 설정·같은 무효값 규칙.
    const configured = Number(
      configService.get<string | number>('RESERVATION_PROJECTION_SETTLE_MS', DEFAULT_SETTLE_MS),
    );
    this.settleMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SETTLE_MS;
  }

  private readonly settleMs: number;

  /** 시계·대기는 테스트가 갈아끼운다. */
  protected now(): Date {
    return new Date();
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** `limit: null` 은 «확인했으니 고치기» — 한도를 무시하고 처리자를 남긴다. */
  async run(opts: { limit: number | null; forcedBy?: string }): Promise<ReconcileRunRecord> {
    const cutoverAt = await this.cutover.get();
    const capability = CHANNEL_CAPABILITIES[CHANNEL];
    if (!cutoverAt || capability?.integration !== 'api' || capability.reservation.kind !== 'projection') {
      return { id: null, ...emptyResult('skipped') };
    }
    const now = this.now();
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
    // 이벤트 소비자와 같은 규칙: 스냅샷을 읽은 시각(readAt)에서 정착 지연만큼 기다린 뒤 게이트를 연다.
    // 읽기 직전 core 변경의 가용재고 이벤트가 아직 Kafka 에 있을 수 있어서다.
    const readAt = this.now();
    if (eligible.length > 0) await this.sleep(this.settleMs + 1000); // 타이머가 1ms 일찍 깨도 «정착 지연보다 젊다» 로 전부 막히지 않게
    const writes = await this.projection.toWrites(eligible, readAt, this.now());
    const firstDiffs = writes
      .map((w) => ({ ...w, current: medusaQty.get(w.lineItemId) ?? 0 }))
      .filter((w) => w.quantity !== w.current);

    // 1-b) 기다리는 사이 core 가 바뀌었을 수 있다(예: 예약을 풀어 목표가 올랐다) — 고칠 줄만 core 를 다시 읽는다.
    //      목표가 처음 읽은 값과 다르면 이번 회차에서 빼고 deferred 로 센다. 새 목표로 쓰지 않는 이유: 새 목표는
    //      방금 읽은 스냅샷이라 정착 지연을 지나지 않았다(감소 게이트가 열리지 않는다). 그 변화는 이벤트 경로가 이미 맡았다.
    //      다시 읽기가 던지면 처음 읽기 실패와 같다(던짐 → skipped, 쓰기 0).
    const freshTargets = await this.readTargets(firstDiffs.map((w) => w.lineItemId));
    let deferred = 0;
    const diffs = firstDiffs.filter((w) => {
      if (freshTargets.get(w.lineItemId) === w.quantity) return true;
      deferred += 1;
      return false;
    });

    // 2) 한도 판정 — Medusa 에 쓰지 않고 계획만 받아(dry run) 실제로 «set» 이 될 줄만 센다.
    //    관리 대상이 아닌 줄(not_managed)·막힌 감소(deferred)·이미 같은 줄이 한도를 오염시키지 않게. 실패하면 읽기 실패와 같다(던짐 → skipped).
    const dry = new Map<string, LineItemReservationResult>();
    for (let i = 0; i < diffs.length; i += WRITE_CHUNK) {
      const chunk = diffs.slice(i, i + WRITE_CHUNK);
      for (const r of await this.medusaClient.setLineItemReservations(toRequest(chunk), { dryRun: true })) {
        dry.set(r.lineItemId, r);
      }
    }
    // 응답에 없는 줄은 Medusa 응답이 깨진 것이다 — 한도 브레이크 밖으로 무제한 보내지 않고 회차를 건너뛴다.
    for (const w of diffs) {
      if (!dry.has(w.lineItemId)) throw new Error(`Medusa dry run 응답에 ${w.lineItemId} 가 없다`);
    }
    let fixFailures = 0;
    const toSend: typeof diffs = [];
    const counted: typeof diffs = [];
    for (const w of diffs) {
      const plan = dry.get(w.lineItemId) as LineItemReservationResult;
      if (plan.outcome === 'not_found') {
        fixFailures += 1; // core 는 알고 Medusa 에는 줄이 없다 — 사람이 봐야 한다
        continue;
      }
      if (plan.outcome !== 'set' && plan.outcome !== 'deferred' && plan.outcome !== 'error') continue; // unchanged·not_managed
      // 정착 지연을 기다리는 사이 이벤트 워커가 같은 줄을 먼저 썼다 — 옛 목표로 덮어쓰지 않고 다음 회차로 미룬다.
      if (plan.quantityBefore !== w.current) {
        deferred += 1;
        continue;
      }
      toSend.push(w);
      if (plan.outcome === 'set') counted.push(w);
    }
    const base = { candidates: candidateIds.length, unknown: unknownIds.size, oldestUnknownAt };
    if (limit !== null && counted.length > limit) {
      const examples: ReconcileExample[] = counted.slice(0, EXAMPLE_LIMIT).map((w) => ({
        lineItemId: w.lineItemId,
        current: (dry.get(w.lineItemId) as LineItemReservationResult).quantityBefore,
        target: w.quantity,
      }));
      return { ...emptyResult('halted'), ...base, deferred, examples };
    }

    // 3) 쓰기 — 묶음이 던지면 그 묶음 줄을 실패로 세고 다음 묶음으로.
    let fixes = 0;
    for (let i = 0; i < toSend.length; i += WRITE_CHUNK) {
      const chunk = toSend.slice(i, i + WRITE_CHUNK);
      try {
        const results = await this.medusaClient.setLineItemReservations(toRequest(chunk));
        const seen = new Set<string>();
        for (const r of results) {
          seen.add(r.lineItemId);
          if (r.outcome === 'set') fixes += 1;
          else if (r.outcome === 'error' || r.outcome === 'not_found') fixFailures += 1;
          else if (r.outcome === 'deferred') deferred += 1;
        }
        // 결과에 없는 줄은 어떻게 됐는지 모른다 — 실패로 센다.
        fixFailures += chunk.filter((w) => !seen.has(w.lineItemId)).length;
      } catch (error) {
        fixFailures += chunk.length;
        this.logger.warn(`예약 대사 쓰기 묶음 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { ...emptyResult('applied'), ...base, fixes, fixFailures, deferred };
  }

  /** 줄 → 지금 core 목표(판매 단위). core 가 모르게 된 줄은 맵에 없다 — 호출부가 «바뀜»으로 다룬다. 실패는 던진다. */
  private async readTargets(lineItemIds: string[]): Promise<Map<string, number>> {
    const targets = new Map<string, number>();
    for (let i = 0; i < lineItemIds.length; i += CORE_LINE_STATE_BATCH) {
      const res = await this.coreClient.states(CHANNEL, lineItemIds.slice(i, i + CORE_LINE_STATE_BATCH));
      for (const l of res.lines) {
        if (l.channelOrderItemId !== null) targets.set(l.channelOrderItemId, reservationTarget(l));
      }
    }
    return targets;
  }
}

function toRequest(chunk: { lineItemId: string; quantity: number; allowDecrease: boolean }[]) {
  return chunk.map(({ lineItemId, quantity, allowDecrease }) => ({ lineItemId, quantity, allowDecrease }));
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
