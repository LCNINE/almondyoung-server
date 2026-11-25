import { Injectable, Logger } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { sql } from 'drizzle-orm';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { CarrierError, type CarrierCode, type CarrierScan } from '../waybill/carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import { carrierScansToTrackingEvents } from '../services/carrier-tracking-events';
import { ShipmentDeliveryTrackingService } from '../services/shipment-delivery-tracking.service';
import { summarizeScans } from './carrier-tracking.judge';

export interface CarrierTrackingTarget {
  dispatchAttemptId: string;
  dispatchedAt: Date;
  carrier: CarrierCode;
  trackingNo: string;
  /** 되돌린 출고 — 택배사가 가져갔는지만 보고 배송 이력에는 넣지 않는다 */
  recalled: boolean;
}

export type CarrierTrackingCheckResult =
  | {
      outcome: 'answered';
      latest: CarrierScan | null;
      recorded: number;
      delivered: number;
      ingestRejected: boolean;
    }
  | { outcome: 'rejected'; code: string }
  | { outcome: 'failed'; code: string; transient: boolean };

/** 한 운송장을 택배사에 묻고 결과를 남긴다. 자동 조회와 «지금 다시 조회»가 함께 쓴다. */
@Injectable()
export class CarrierTrackingChecker {
  private readonly logger = new Logger(CarrierTrackingChecker.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly carriers: CarrierGatewayRegistry,
    private readonly tracking: ShipmentDeliveryTrackingService,
  ) {}

  /** 자동 조회를 지원하는 택배사. 설정이 빠진 택배사도 들어간다 — 못 묻고 있다는 사실을 화면이 알아야 한다. */
  trackableCarriers(): CarrierCode[] {
    return this.carriers
      .all()
      .filter((gateway) => gateway.track && gateway.capabilities.canTrack)
      .map((gateway) => gateway.carrier);
  }

  configuredCarriers(): CarrierCode[] {
    return this.trackableCarriers().filter((carrier) => this.carriers.get(carrier)?.isConfigured());
  }

  async check(target: CarrierTrackingTarget, now: () => Date = () => new Date()): Promise<CarrierTrackingCheckResult> {
    const attemptedAt = now();
    const gateway = this.carriers.get(target.carrier);
    if (!gateway?.track || !gateway.isConfigured()) {
      await this.saveFailure(target, attemptedAt, 'unknown', 'not_configured');
      return { outcome: 'failed', code: 'not_configured', transient: false };
    }

    let scans: CarrierScan[];
    try {
      scans = await gateway.track(target.trackingNo);
    } catch (error) {
      const invalid = error instanceof CarrierError && error.details.invalidWaybill === true;
      const code = error instanceof CarrierError ? (error.details.code ?? error.outcome) : 'unexpected_error';
      this.logger.warn(
        `배송추적 조회 실패 (attempt ${target.dispatchAttemptId}, ${target.carrier} ${code}): ` +
          (error instanceof Error ? error.message : String(error)),
      );
      await this.saveFailure(target, attemptedAt, invalid ? 'rejected' : 'unknown', code);
      if (invalid) return { outcome: 'rejected', code };
      return {
        outcome: 'failed',
        code,
        transient: error instanceof CarrierError && error.outcome === 'transient_rejection',
      };
    }

    const { latest, acceptedScanAt } = summarizeScans(scans);
    let recorded = 0;
    let delivered = 0;
    let ingestRejected = false;
    if (!target.recalled) {
      for (const event of carrierScansToTrackingEvents(target.carrier, scans, target.dispatchedAt)) {
        try {
          const result = await this.tracking.recordProviderEvent(target.dispatchAttemptId, event);
          if (result.replayed) continue;
          recorded++;
          if (result.status === 'delivered') delivered++;
        } catch (error) {
          // 뒤 이벤트가 앞 이벤트를 전제하므로 이 운송장의 나머지는 다음 조회로 미룬다.
          ingestRejected = true;
          this.logger.warn(
            `배송추적 이벤트 수신 거절 (attempt ${target.dispatchAttemptId}, ${event.providerEventId}): ` +
              (error instanceof Error ? error.message : String(error)),
          );
          break;
        }
      }
    }
    await this.saveAnswer(target, attemptedAt, now(), latest, acceptedScanAt);
    return { outcome: 'answered', latest, recorded, delivered, ingestRejected };
  }

  private async saveFailure(
    target: CarrierTrackingTarget,
    attemptedAt: Date,
    outcome: 'rejected' | 'unknown',
    errorCode: string,
    tx?: DbTx,
  ): Promise<void> {
    const t = wmsTables.carrierTrackingChecks;
    const values = { attemptedAt, outcome, errorCode: errorCode.slice(0, 64) };
    // 번호가 틀렸다는 답도 택배사의 답이다
    const answered = outcome === 'rejected' ? { answeredAt: attemptedAt } : {};
    await this.db.run(async (trx) => {
      await trx
        .insert(t)
        .values({ dispatchAttemptId: target.dispatchAttemptId, ...values, ...answered })
        .onConflictDoUpdate({
          target: t.dispatchAttemptId,
          set: { ...values, ...answered },
          setWhere: sql`${t.attemptedAt} <= ${attemptedAt.toISOString()}::timestamptz`,
        });
    }, tx);
  }

  private async saveAnswer(
    target: CarrierTrackingTarget,
    attemptedAt: Date,
    answeredAt: Date,
    latest: CarrierScan | null,
    acceptedScanAt: Date | null,
    tx?: DbTx,
  ): Promise<void> {
    const t = wmsTables.carrierTrackingChecks;
    const values = {
      attemptedAt,
      answeredAt,
      outcome: latest ? ('scans' as const) : ('no_scan' as const),
      errorCode: null,
    };
    // 한번 본 스캔은 택배사가 빈 답을 줘도 지우지 않는다
    const scan = latest
      ? {
          scanCode: latest.statusCode.slice(0, 16),
          scanStatus: latest.status,
          scanAt: latest.occurredAt,
          scanLocation: latest.location?.slice(0, 255) ?? null,
          scanReason: latest.reasonLabel?.slice(0, 255) ?? null,
        }
      : {};
    await this.db.run(async (trx) => {
      await trx
        .insert(t)
        .values({ dispatchAttemptId: target.dispatchAttemptId, ...values, ...scan, acceptedScanAt })
        .onConflictDoUpdate({
          target: t.dispatchAttemptId,
          set: { ...values, ...scan, ...(acceptedScanAt ? { acceptedScanAt } : {}) },
          setWhere: sql`${t.attemptedAt} <= ${attemptedAt.toISOString()}::timestamptz`,
        });
    }, tx);
  }
}
