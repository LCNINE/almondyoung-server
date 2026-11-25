import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, desc, eq, inArray, isNotNull, SQL } from 'drizzle-orm';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import type { CarrierCode } from '../waybill/carrier/carrier-gateway.interface';
import { CarrierTrackingChecker } from './carrier-tracking.checker';
import {
  CARRIER_ATTENTION_KINDS,
  TRACKING_STALE_MS,
  judgeTracking,
  type TrackingCheckFacts,
  type TrackingConfirmationFacts,
  type TrackingJudgement,
} from './carrier-tracking.judge';

export type TrackedAttempt = {
  dispatchAttemptId: string;
  attemptNo: number;
  attemptStatus: string;
  shipmentId: string;
  shipmentStatus: string;
  carrier: CarrierCode;
  trackingNo: string;
  dispatchedAt: Date;
  carrierAcceptedAt: Date | null;
  check: TrackingCheckFacts | null;
  confirmation: TrackingConfirmationFacts | null;
  judgement: TrackingJudgement;
};

export type TrackingPolling = {
  /** 택배사가 마지막으로 답한 시각 */
  lastAnsweredAt: Date | null;
  /** 물어야 할 운송장이 있는데 답을 못 받고 있다 */
  failing: boolean;
};

@Injectable()
export class CarrierTrackingReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly checker: CarrierTrackingChecker,
  ) {}

  /** 배송완료 전인 상자와, 되돌렸는데 택배사가 가져간 상자. 사람이 볼 것부터 정렬한다. */
  async listOpen(now: Date, tx?: DbTx): Promise<TrackedAttempt[]> {
    const carriers = this.checker.trackableCarriers();
    if (carriers.length === 0) return [];
    const a = wmsTables.dispatchAttempts;
    const s = wmsTables.shipments;
    const c = wmsTables.carrierTrackingChecks;
    return this.dbService.run(async (trx) => {
      const open = await this.load(
        trx,
        and(
          eq(a.status, 'dispatched'),
          inArray(s.status, ['shipped', 'in_transit']),
          isNotNull(s.warehouseId),
          eq(wmsTables.waybills.status, 'used'),
          inArray(wmsTables.waybills.carrier, carriers),
        ),
        now,
      );
      const recalled = await this.load(
        trx,
        and(eq(a.status, 'recalled'), isNotNull(c.acceptedScanAt), inArray(wmsTables.waybills.carrier, carriers)),
        now,
      );
      return [...open, ...recalled].sort(
        (x, y) =>
          kindRank(x) - kindRank(y) ||
          x.dispatchedAt.getTime() - y.dispatchedAt.getTime() ||
          x.dispatchAttemptId.localeCompare(y.dispatchAttemptId),
      );
    }, tx);
  }

  async listForShipment(shipmentId: string, now: Date, tx?: DbTx): Promise<TrackedAttempt[]> {
    const carriers = this.checker.trackableCarriers();
    if (carriers.length === 0) return [];
    return this.dbService.run(
      (trx) =>
        this.load(
          trx,
          and(
            eq(wmsTables.dispatchAttempts.shipmentId, shipmentId),
            inArray(wmsTables.dispatchAttempts.status, ['dispatched', 'recalled']),
            eq(wmsTables.dispatchAttempts.kind, 'warehouse'),
            inArray(wmsTables.waybills.carrier, carriers),
          ),
          now,
        ),
      tx,
    );
  }

  async findAttempt(dispatchAttemptId: string, now: Date, tx?: DbTx): Promise<TrackedAttempt | undefined> {
    return this.dbService.run(async (trx) => {
      const [row] = await this.load(trx, eq(wmsTables.dispatchAttempts.id, dispatchAttemptId), now);
      return row;
    }, tx);
  }

  /** 상자마다 든 판매주문 번호 */
  async ordersOf(
    shipmentIds: string[],
    tx?: DbTx,
  ): Promise<Map<string, { salesOrderId: string; orderNo: string; channelOrderId: string }[]>> {
    if (shipmentIds.length === 0) return new Map();
    const so = wmsTables.salesOrders;
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .selectDistinct({
          shipmentId: wmsTables.shipmentLines.shipmentId,
          salesOrderId: so.id,
          displayOrderNo: so.displayOrderNo,
          channelOrderId: so.channelOrderId,
        })
        .from(wmsTables.shipmentLines)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
        )
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .innerJoin(so, eq(so.id, wmsTables.fulfillmentOrders.salesOrderId))
        .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
        .orderBy(asc(so.displayOrderNo), asc(so.id));
      const out = new Map<string, { salesOrderId: string; orderNo: string; channelOrderId: string }[]>();
      for (const row of rows) {
        out.set(row.shipmentId, [
          ...(out.get(row.shipmentId) ?? []),
          {
            salesOrderId: row.salesOrderId,
            orderNo: row.displayOrderNo ?? row.channelOrderId,
            channelOrderId: row.channelOrderId,
          },
        ]);
      }
      return out;
    }, tx);
  }

  /** 확인 이력. 최근 것부터. */
  async confirmationsOf(dispatchAttemptIds: string[], tx?: DbTx): Promise<Map<string, TrackingConfirmationFacts[]>> {
    if (dispatchAttemptIds.length === 0) return new Map();
    const t = wmsTables.carrierTrackingConfirmations;
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(t)
        .where(inArray(t.dispatchAttemptId, dispatchAttemptIds))
        .orderBy(desc(t.createdAt), desc(t.id));
      const out = new Map<string, TrackingConfirmationFacts[]>();
      for (const { dispatchAttemptId, ...row } of rows) {
        out.set(dispatchAttemptId, [...(out.get(dispatchAttemptId) ?? []), row]);
      }
      return out;
    }, tx);
  }

  private async latestConfirmations(
    trx: DbTx,
    dispatchAttemptIds: string[],
  ): Promise<Map<string, TrackingConfirmationFacts>> {
    if (dispatchAttemptIds.length === 0) return new Map();
    const t = wmsTables.carrierTrackingConfirmations;
    const rows = await trx
      .selectDistinctOn([t.dispatchAttemptId])
      .from(t)
      .where(inArray(t.dispatchAttemptId, dispatchAttemptIds))
      .orderBy(t.dispatchAttemptId, desc(t.createdAt), desc(t.id));
    return new Map(rows.map(({ dispatchAttemptId, ...row }) => [dispatchAttemptId, row]));
  }

  private async load(trx: DbTx, where: SQL | undefined, now: Date): Promise<TrackedAttempt[]> {
    const a = wmsTables.dispatchAttempts;
    const s = wmsTables.shipments;
    const w = wmsTables.waybills;
    const c = wmsTables.carrierTrackingChecks;
    const rows = await trx
      .select({
        dispatchAttemptId: a.id,
        attemptNo: a.attemptNo,
        attemptStatus: a.status,
        shipmentId: a.shipmentId,
        shipmentStatus: s.status,
        carrier: w.carrier,
        trackingNo: w.trackingNo,
        dispatchedAt: a.dispatchedAt,
        carrierAcceptedAt: a.carrierAcceptedAt,
        check: c,
      })
      .from(a)
      .innerJoin(s, eq(s.id, a.shipmentId))
      .innerJoin(w, eq(w.id, a.waybillId))
      .leftJoin(c, eq(c.dispatchAttemptId, a.id))
      .where(where)
      .orderBy(asc(a.dispatchedAt), asc(a.id));
    const confirmations = await this.latestConfirmations(
      trx,
      rows.map((row) => row.dispatchAttemptId),
    );
    return rows.flatMap((row) => {
      const { trackingNo, dispatchedAt } = row;
      if (!trackingNo || !dispatchedAt) return [];
      const confirmation = confirmations.get(row.dispatchAttemptId) ?? null;
      return [
        {
          ...row,
          trackingNo,
          dispatchedAt,
          confirmation,
          judgement: judgeTracking({ ...row, dispatchedAt, confirmation }, now),
        },
      ];
    });
  }
}

function kindRank(row: TrackedAttempt): number {
  return row.judgement.kind === null
    ? CARRIER_ATTENTION_KINDS.length
    : CARRIER_ATTENTION_KINDS.indexOf(row.judgement.kind);
}

/** 자동 조회가 되고 있는가. 방금 출고한 것만 있으면 아직 물을 차례가 안 왔을 뿐이다. */
export function pollingOf(rows: TrackedAttempt[], now: Date): TrackingPolling {
  let lastAnsweredAt: Date | null = null;
  let waitingLong = false;
  for (const row of rows) {
    if (row.attemptStatus !== 'dispatched') continue;
    const answeredAt = row.check?.answeredAt ?? null;
    if (answeredAt && (!lastAnsweredAt || answeredAt > lastAnsweredAt)) lastAnsweredAt = answeredAt;
    if (row.judgement.kind !== 'poll_ended' && now.getTime() - row.dispatchedAt.getTime() > TRACKING_STALE_MS) {
      waitingLong = true;
    }
  }
  const stale = lastAnsweredAt === null || now.getTime() - lastAnsweredAt.getTime() > TRACKING_STALE_MS;
  return { lastAnsweredAt, failing: waitingLong && stale };
}
