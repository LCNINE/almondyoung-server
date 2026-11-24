import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import {
  CarrierTrackingChecker,
  type CarrierTrackingCheckResult,
  type CarrierTrackingTarget,
} from '../carrier-tracking/carrier-tracking.checker';
import { CARRIER_TRACKING_WINDOW_DAYS } from '../carrier-tracking/carrier-tracking.judge';
import type { CarrierCode, CarrierScan } from '../waybill/carrier/carrier-gateway.interface';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';

export { CARRIER_TRACKING_WINDOW_DAYS };
export type { CarrierTrackingTarget };

/**
 * 한 주기에 부르는 운송장 수의 상한. 한진 페이서(5 TPS) 기준 약 400초다. 넘친 분은 다음 주기가
 * 가져간다 — 오래 안 물은 것부터 부르므로 굶는 운송장이 없다.
 */
export const CARRIER_TRACKING_BATCH = 2000;

/** 이만큼 잇달아 못 물으면 택배사 쪽 장애로 보고 이번 주기를 접는다. 하나만 안 되는 운송장은 건너뛴다. */
export const CARRIER_TRACKING_MAX_CONSECUTIVE_FAILURES = 3;

/** 배송 이력에 자리가 없는 예외 상태 — 마지막 스캔이 이것이면 센다(화면은 carrier_tracking_checks 를 읽는다). */
const EXCEPTION_STATUSES: ReadonlySet<CarrierScan['status']> = new Set(['failed', 'pickup_missed', 'canceled']);

export interface CarrierTrackingPollResult {
  skipped?: 'maintenance' | 'no_trackable_carrier';
  targets: number;
  /** 캐리어가 응답한 운송장 수 (ERROR-01 = 빈 이력 포함). */
  tracked: number;
  /** 새로 기록된 이벤트 수. 재생(이미 기록된 스캔)은 세지 않는다. */
  recorded: number;
  delivered: number;
  /** 마지막 스캔이 92 배송불가·08 미집하·03 예약취소인 운송장 수. */
  exceptions: number;
  /** 캐리어가 그 운송장을 확정 거절한 수 (예: ERROR-02 체크디지트). */
  carrierRejected: number;
  /** 수신 경로가 이벤트를 거절한 운송장 수. */
  ingestRejected: number;
  /** 답을 못 받은 운송장 수. 다음 주기에 다시 묻는다. */
  failed: number;
  /** 주기를 도중에 멈춘 사유 (캐리어 오류 코드). */
  aborted?: string;
}

/**
 * 캐리어 배송추적 폴러 (#917).
 *
 * 출고된 운송장의 스캔 이력을 캐리어에서 긁어 `ShipmentDeliveryTrackingService` 에 넣는다 — shipment 이
 * `in_transit`/`delivered` 로 오르고, 배송완료가 공동현관 비번 1차 파기와 `shipment.delivered` 발행을
 * 촉발한다. 수신 서비스를 HTTP(`tracking-ingest` 스코프)가 아니라 직접 부른다: 같은 프로세스 안이고,
 * 그 엔드포인트는 외부 생산자용으로 남는다.
 *
 * **주기당 한 태스크에서만 돈다(`@CronOnce`).** 수신 경로가 `providerEventId` 로 멱등이라 겹쳐도 결과는
 * 같지만, 겹치면 한진 10 TPS 한도를 태스크 수만큼 나눠 쓰게 된다. 한도 준수는 게이트웨이의 프로세스 내
 * 페이서가 맡는다.
 *
 * 되돌린(`recalled`) attempt 는 택배사가 그 송장을 가져갔는지만 본다 — 배송 이력에는 넣지 않는다. recall 진행
 * 중(`recovery_required`)인 attempt 는 대상이 아니다.
 */
@Injectable()
export class CarrierTrackingPoller {
  private readonly logger = new Logger(CarrierTrackingPoller.name);
  private isPolling = false;

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly checker: CarrierTrackingChecker,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  @CronOnce('20 * * * *', { name: 'carrier-tracking-poll', timeZone: 'Asia/Seoul' })
  async poll(): Promise<void> {
    if (this.isPolling) {
      this.logger.debug('이전 배송추적 폴링 진행 중, 건너뜀');
      return;
    }
    this.isPolling = true;
    try {
      const result = await this.pollOnce(new Date());
      if (result.skipped) return;
      const summary =
        `대상 ${result.targets} · 응답 ${result.tracked} · 신규 이벤트 ${result.recorded} · 배송완료 ${result.delivered}` +
        ` · 예외상태 ${result.exceptions} · 캐리어 거절 ${result.carrierRejected} · 수신 거절 ${result.ingestRejected} · 실패 ${result.failed}`;
      if (result.aborted) this.logger.warn(`배송추적 폴링 중단(${result.aborted}) — ${summary}`);
      else this.logger.log(`배송추적 폴링 — ${summary}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(`배송추적 폴링 실패: ${message}`, error instanceof Error ? error.stack : undefined);
    } finally {
      this.isPolling = false;
    }
  }

  /** 한 주기를 돈다. `now` 를 인자로 받는 것은 테스트가 시계를 고정하기 위해서다. */
  async pollOnce(now: Date): Promise<CarrierTrackingPollResult> {
    const result: CarrierTrackingPollResult = {
      targets: 0,
      tracked: 0,
      recorded: 0,
      delivered: 0,
      exceptions: 0,
      carrierRejected: 0,
      ingestRejected: 0,
      failed: 0,
    };
    if (!this.workflowGate.shouldRunCarrierTrackingPoll()) return { ...result, skipped: 'maintenance' };

    const trackable = this.checker.configuredCarriers();
    if (trackable.length === 0) return { ...result, skipped: 'no_trackable_carrier' };

    const since = new Date(now.getTime() - CARRIER_TRACKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const targets = await this.findTargets(trackable, since);
    result.targets = targets.length;

    let consecutiveFailures = 0;
    for (const target of targets) {
      const checked = await this.checkSafely(target);
      if (checked.outcome === 'failed') {
        result.failed++;
        consecutiveFailures++;
        // 호출량 초과는 다음 운송장도 똑같이 맞는다
        if (checked.transient || consecutiveFailures >= CARRIER_TRACKING_MAX_CONSECUTIVE_FAILURES) {
          result.aborted = checked.code;
          break;
        }
        continue;
      }
      consecutiveFailures = 0;
      if (checked.outcome === 'rejected') {
        result.carrierRejected++;
        continue;
      }
      result.tracked++;
      result.recorded += checked.recorded;
      result.delivered += checked.delivered;
      if (checked.ingestRejected) result.ingestRejected++;
      if (checked.latest && EXCEPTION_STATUSES.has(checked.latest.status)) result.exceptions++;
    }
    return result;
  }

  /** 한 운송장의 예외가 나머지를 멈추지 않게 한다 */
  private async checkSafely(target: CarrierTrackingTarget): Promise<CarrierTrackingCheckResult> {
    try {
      return await this.checker.check(target);
    } catch (error) {
      this.logger.error(
        `배송추적 확인 기록 실패 (attempt ${target.dispatchAttemptId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return { outcome: 'failed', code: 'record_failed', transient: false };
    }
  }

  /**
   * 폴링 대상: `since` 이후에 출고된 창고 상자 중 출고된 채 배송완료 전인 것과 되돌린 것. 오래 안 물은 것부터,
   * 한 번도 안 물은 것 사이에서는 오래된 출고부터.
   */
  async findTargets(carriers: CarrierCode[], since: Date, tx?: DbTx): Promise<CarrierTrackingTarget[]> {
    return this.db.run(async (trx) => {
      const a = wmsTables.dispatchAttempts;
      const w = wmsTables.waybills;
      const s = wmsTables.shipments;
      const c = wmsTables.carrierTrackingChecks;
      const rows = await trx
        .select({
          dispatchAttemptId: a.id,
          status: a.status,
          dispatchedAt: a.dispatchedAt,
          carrier: w.carrier,
          trackingNo: w.trackingNo,
        })
        .from(a)
        .innerJoin(w, eq(w.id, a.waybillId))
        .innerJoin(s, eq(s.id, a.shipmentId))
        .leftJoin(c, eq(c.dispatchAttemptId, a.id))
        .where(
          and(
            gte(a.dispatchedAt, since),
            // 입점사 상자는 추적하지 않는다 — 입점사 상자는 in_transit·delivered 전이를 쓰지 않는다
            eq(a.kind, 'warehouse'),
            isNotNull(s.warehouseId),
            inArray(w.carrier, carriers),
            isNotNull(w.trackingNo),
            or(
              and(eq(a.status, 'dispatched'), eq(w.status, 'used'), inArray(s.status, ['shipped', 'in_transit'])),
              eq(a.status, 'recalled'),
            ),
          ),
        )
        .orderBy(sql`${c.attemptedAt} ASC NULLS FIRST`, asc(a.dispatchedAt), asc(a.id))
        .limit(CARRIER_TRACKING_BATCH);
      return rows.flatMap((row) =>
        row.dispatchedAt && row.trackingNo
          ? [
              {
                dispatchAttemptId: row.dispatchAttemptId,
                dispatchedAt: row.dispatchedAt,
                carrier: row.carrier,
                trackingNo: row.trackingNo,
                recalled: row.status === 'recalled',
              },
            ]
          : [],
      );
    }, tx);
  }
}
