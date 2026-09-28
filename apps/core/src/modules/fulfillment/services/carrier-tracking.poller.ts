import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { CarrierError, type CarrierCode, type CarrierScan } from '../waybill/carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import { carrierScansToTrackingEvents } from './carrier-tracking-events';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentDeliveryTrackingService } from './shipment-delivery-tracking.service';

/**
 * 출고 후 이 기간이 지난 운송장은 더 부르지 않는다. 공동현관 비번 백스톱(`EntrancePasswordCleaner`)의
 * 보관 상한과 같은 14일이다 — 그 뒤엔 배송완료가 와도 파기할 비번이 이미 없다.
 *
 * 한진 `ERROR-01` 은 「없는 번호」와 「아직 스캔 안 된 번호」를 구별하지 못하므로(정본 §4.4), 발급됐는데
 * 끝내 한진에 잡히지 않는 운송장을 응답으로는 알아낼 수 없다. 시간 경과가 유일한 종료 조건이다.
 */
export const CARRIER_TRACKING_WINDOW_DAYS = 14;

/**
 * 한 주기에 부르는 운송장 수의 상한. 한진 페이서(5 TPS) 기준 약 400초다. 넘친 분은 다음 주기가
 * 가져간다 — 오래된 출고부터 부르므로 굶는 쪽은 방금 출고된(아직 스캔이 없을 확률이 높은) 건이다.
 */
export const CARRIER_TRACKING_BATCH = 2000;

/** 수신 경로에 자리가 없는 예외 상태 — 마지막 스캔이 이것이면 세어 적체를 드러낸다. */
const EXCEPTION_STATUSES: ReadonlySet<CarrierScan['status']> = new Set(['failed', 'pickup_missed', 'canceled']);

export interface CarrierTrackingTarget {
  dispatchAttemptId: string;
  dispatchedAt: Date;
  carrier: CarrierCode;
  trackingNo: string;
}

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
 * recall 진행 중(`recovery_required`)인 attempt 는 대상이 아니다 — 그쪽 늦은 증거 처리는 수신 경로에
 * 있지만, 폴러가 그걸 자동으로 밀어 넣을지는 recall 운영 흐름과 함께 정할 일이다.
 */
@Injectable()
export class CarrierTrackingPoller {
  private readonly logger = new Logger(CarrierTrackingPoller.name);
  private isPolling = false;

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly carriers: CarrierGatewayRegistry,
    private readonly tracking: ShipmentDeliveryTrackingService,
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
        ` · 예외상태 ${result.exceptions} · 캐리어 거절 ${result.carrierRejected} · 수신 거절 ${result.ingestRejected}`;
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
    };
    if (!this.workflowGate.shouldRunCarrierTrackingPoll()) return { ...result, skipped: 'maintenance' };

    const trackable = this.carriers
      .all()
      .filter((gateway) => gateway.capabilities.canTrack && gateway.track && gateway.isConfigured())
      .map((gateway) => gateway.carrier);
    if (trackable.length === 0) return { ...result, skipped: 'no_trackable_carrier' };

    const since = new Date(now.getTime() - CARRIER_TRACKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const targets = await this.findTargets(trackable, since);
    result.targets = targets.length;

    for (const target of targets) {
      const gateway = this.carriers.get(target.carrier);
      if (!gateway?.track) continue;

      let scans: CarrierScan[];
      try {
        scans = await gateway.track(target.trackingNo);
      } catch (error) {
        if (error instanceof CarrierError && error.outcome === 'definitive_rejection') {
          result.carrierRejected++;
          this.logger.warn(
            `배송추적 거절 (attempt ${target.dispatchAttemptId}, ${target.carrier} ${error.details.code ?? ''}): ${error.message}`,
          );
          continue;
        }
        // -103 호출량 초과·타임아웃은 다음 운송장도 똑같이 맞는다 — 이번 주기를 접고 다음 주기에 다시 부른다.
        result.aborted = error instanceof CarrierError ? (error.details.code ?? error.outcome) : 'unexpected_error';
        this.logger.warn(
          `배송추적 주기 중단 (attempt ${target.dispatchAttemptId}): ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
      result.tracked++;

      const latest = scans.reduce<CarrierScan | undefined>(
        (last, scan) => (!last || scan.occurredAt.getTime() >= last.occurredAt.getTime() ? scan : last),
        undefined,
      );
      if (latest && EXCEPTION_STATUSES.has(latest.status)) {
        result.exceptions++;
        this.logger.warn(
          `배송추적 예외상태 ${latest.statusCode}(${latest.status}) — attempt ${target.dispatchAttemptId}` +
            (latest.reasonLabel ? `, 사유 ${latest.reasonLabel}` : ''),
        );
      }

      for (const event of carrierScansToTrackingEvents(target.carrier, scans, target.dispatchedAt)) {
        try {
          const recorded = await this.tracking.recordProviderEvent(target.dispatchAttemptId, event);
          if (recorded.replayed) continue;
          result.recorded++;
          if (recorded.status === 'delivered') result.delivered++;
        } catch (error) {
          // 뒤 이벤트가 앞 이벤트를 전제하므로 이 운송장의 나머지는 다음 주기로 미룬다.
          result.ingestRejected++;
          this.logger.warn(
            `배송추적 이벤트 수신 거절 (attempt ${target.dispatchAttemptId}, ${event.providerEventId}): ` +
              (error instanceof Error ? error.message : String(error)),
          );
          break;
        }
      }
    }
    return result;
  }

  /**
   * 폴링 대상: 출고(`dispatched`)된 attempt 중 운송장이 붙어 있고, 상자가 아직 배송완료 전이며,
   * `since` 이후에 출고된 것. 오래된 출고부터.
   */
  async findTargets(carriers: CarrierCode[], since: Date, tx?: DbTx): Promise<CarrierTrackingTarget[]> {
    return this.db.run(async (trx) => {
      const rows = await trx
        .select({
          dispatchAttemptId: wmsTables.dispatchAttempts.id,
          dispatchedAt: wmsTables.dispatchAttempts.dispatchedAt,
          carrier: wmsTables.waybills.carrier,
          trackingNo: wmsTables.waybills.trackingNo,
        })
        .from(wmsTables.dispatchAttempts)
        .innerJoin(wmsTables.waybills, eq(wmsTables.waybills.id, wmsTables.dispatchAttempts.waybillId))
        .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.dispatchAttempts.shipmentId))
        .where(
          and(
            eq(wmsTables.dispatchAttempts.status, 'dispatched'),
            gte(wmsTables.dispatchAttempts.dispatchedAt, since),
            inArray(wmsTables.shipments.status, ['shipped', 'in_transit']),
            eq(wmsTables.waybills.status, 'used'),
            inArray(wmsTables.waybills.carrier, carriers),
            isNotNull(wmsTables.waybills.trackingNo),
          ),
        )
        .orderBy(asc(wmsTables.dispatchAttempts.dispatchedAt), asc(wmsTables.dispatchAttempts.id))
        .limit(CARRIER_TRACKING_BATCH);
      return rows.flatMap((row) =>
        row.dispatchedAt && row.trackingNo
          ? [
              {
                dispatchAttemptId: row.dispatchAttemptId,
                dispatchedAt: row.dispatchedAt,
                carrier: row.carrier,
                trackingNo: row.trackingNo,
              },
            ]
          : [],
      );
    }, tx);
  }
}
