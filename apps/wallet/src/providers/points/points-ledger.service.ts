import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  pointEventDetails,
  pointEvents,
  pointHolds,
  pointHoldDetails,
} from '../../schema';
import { DbTx } from '../../types';

export interface PointsOperationRequest {
  intentId: string;
  /** chargeId is stored as legId in the point tables */
  legId: string;
  attemptId?: string;
  amount: number;
  currency: string;
  userId: string;
  idempotencyKey: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

export interface PointsOperationResult {
  resultStatus:
    | 'AUTHORIZED'
    | 'CAPTURED'
    | 'CANCELLED'
    | 'REFUNDED'
    | 'FAILED';
  providerTransactionId?: string;
  raw?: Record<string, unknown>;
}

interface LotAvailabilityRow {
  earnedEventDetailId: string;
  confirmedAmount: number;
  reservedAmount: number;
}

interface RedeemDetailRow {
  redeemDetailId: string;
  earnedEventDetailId: string;
  redeemAmount: number;
}

interface PointLegTotals {
  redeemedAmount: number;
  refundedAmount: number;
}

@Injectable()
export class PointsLedgerService {
  async authorize(
    tx: DbTx,
    req: PointsOperationRequest,
  ): Promise<PointsOperationResult> {
    if (!req.attemptId) {
      return this.failedResult('AUTHORIZE', 'ATTEMPT_ID_REQUIRED');
    }

    await this.acquireUserLock(tx, req.userId);

    const existingByKey = await this.findHoldByAuthorizeKey(tx, req.idempotencyKey);
    if (existingByKey) {
      return this.buildAuthorizeResultFromHold(existingByKey.id, existingByKey.status);
    }

    const balance = await this.readBalance(tx, req.userId);
    if (balance.availableAmount < req.amount) {
      return this.failedResult('AUTHORIZE', 'INSUFFICIENT_POINTS', {
        requestedAmount: req.amount,
        availableAmount: balance.availableAmount,
      });
    }

    const lotRows = await this.readLotAvailability(tx, req.userId);
    const allocations = this.allocateAmountAcrossLots(req.amount, lotRows);

    if (!allocations) {
      return this.failedResult('AUTHORIZE', 'INSUFFICIENT_POINTS', {
        requestedAmount: req.amount,
        availableAmount: balance.availableAmount,
      });
    }

    const insertedHolds = await tx
      .insert(pointHolds)
      .values({
        userId: req.userId,
        intentId: req.intentId,
        legId: req.legId,
        authorizeAttemptId: req.attemptId,
        authorizeProviderIdempotencyKey: req.idempotencyKey,
        amount: req.amount,
        status: 'AUTHORIZED',
      })
      .returning({ id: pointHolds.id });

    const hold = insertedHolds[0];
    if (!hold) {
      throw new Error('POINTS_HOLD_INSERT_FAILED');
    }

    await tx.insert(pointHoldDetails).values(
      allocations.map((allocation) => ({
        holdId: hold.id,
        earnedEventDetailId: allocation.earnedEventDetailId,
        amount: allocation.amount,
      })),
    );

    return {
      resultStatus: 'AUTHORIZED',
      providerTransactionId: hold.id,
      raw: {
        providerType: 'POINTS',
        operation: 'AUTHORIZE',
        holdId: hold.id,
        holdAmount: req.amount,
      },
    };
  }

  async capture(
    tx: DbTx,
    req: PointsOperationRequest,
  ): Promise<PointsOperationResult> {
    await this.acquireUserLock(tx, req.userId);

    const existingCaptureEvent = await this.findEventByProviderIdempotencyKey(
      tx,
      req.idempotencyKey,
    );
    if (existingCaptureEvent) {
      if (existingCaptureEvent.eventType === 'REDEEM') {
        return {
          resultStatus: 'CAPTURED',
          providerTransactionId:
            existingCaptureEvent.providerTransactionId ?? existingCaptureEvent.id,
          raw: {
            providerType: 'POINTS',
            operation: 'CAPTURE',
            pointEventId: existingCaptureEvent.id,
            idempotentReplay: true,
          },
        };
      }
      return this.failedResult('CAPTURE', 'IDEMPOTENCY_KEY_CONFLICT', {
        idempotencyKey: req.idempotencyKey,
        eventType: existingCaptureEvent.eventType,
      });
    }

    const latestHold = await this.findLatestHoldByLegId(tx, req.legId);
    if (!latestHold) {
      const totals = await this.readPointLegTotals(tx, req.userId, req.legId);
      if (totals.redeemedAmount > 0) {
        return {
          resultStatus: 'CAPTURED',
          raw: {
            providerType: 'POINTS',
            operation: 'CAPTURE',
            inferredFromLedger: true,
            redeemedAmount: totals.redeemedAmount,
          },
        };
      }
      return this.failedResult('CAPTURE', 'POINT_HOLD_NOT_FOUND', { legId: req.legId });
    }

    if (latestHold.status === 'CAPTURED') {
      return {
        resultStatus: 'CAPTURED',
        providerTransactionId: latestHold.capturedEventId ?? latestHold.id,
        raw: {
          providerType: 'POINTS',
          operation: 'CAPTURE',
          holdId: latestHold.id,
          idempotentReplay: true,
        },
      };
    }

    if (latestHold.status !== 'AUTHORIZED') {
      return this.failedResult('CAPTURE', 'POINT_HOLD_NOT_AUTHORIZED', {
        holdId: latestHold.id,
        holdStatus: latestHold.status,
      });
    }

    const holdDetailRows = await tx
      .select({
        earnedEventDetailId: pointHoldDetails.earnedEventDetailId,
        amount: pointHoldDetails.amount,
      })
      .from(pointHoldDetails)
      .where(eq(pointHoldDetails.holdId, latestHold.id))
      .orderBy(asc(pointHoldDetails.createdAt));

    if (holdDetailRows.length === 0) {
      return this.failedResult('CAPTURE', 'POINT_HOLD_DETAILS_NOT_FOUND', {
        holdId: latestHold.id,
      });
    }

    const insertedEvents = await tx
      .insert(pointEvents)
      .values({
        userId: req.userId,
        eventType: 'REDEEM',
        amount: -latestHold.amount,
        intentId: req.intentId,
        legId: req.legId,
        attemptId: req.attemptId ?? null,
        providerIdempotencyKey: req.idempotencyKey,
        reasonCode: 'POINTS_CAPTURE_REDEEM',
        reasonMessage: 'Points capture confirmed redeem event',
        metadata: { holdId: latestHold.id },
      })
      .returning({ id: pointEvents.id });

    const redeemEvent = insertedEvents[0];
    if (!redeemEvent) {
      throw new Error('POINT_REDEEM_EVENT_INSERT_FAILED');
    }

    await tx
      .update(pointEvents)
      .set({
        originalEventId: redeemEvent.id,
        providerTransactionId: redeemEvent.id,
      })
      .where(eq(pointEvents.id, redeemEvent.id));

    await tx.insert(pointEventDetails).values(
      holdDetailRows.map((detail) => ({
        pointEventId: redeemEvent.id,
        userId: req.userId,
        eventType: 'REDEEM' as const,
        amount: -detail.amount,
        earnedEventDetailId: detail.earnedEventDetailId,
        originalEventDetailId: null,
      })),
    );

    await tx
      .update(pointHolds)
      .set({
        status: 'CAPTURED',
        capturedEventId: redeemEvent.id,
        captureAttemptId: req.attemptId ?? null,
        captureProviderIdempotencyKey: req.idempotencyKey,
        updatedAt: new Date(),
      })
      .where(eq(pointHolds.id, latestHold.id));

    return {
      resultStatus: 'CAPTURED',
      providerTransactionId: redeemEvent.id,
      raw: {
        providerType: 'POINTS',
        operation: 'CAPTURE',
        holdId: latestHold.id,
        pointEventId: redeemEvent.id,
      },
    };
  }

  async cancel(
    tx: DbTx,
    req: PointsOperationRequest,
  ): Promise<PointsOperationResult> {
    await this.acquireUserLock(tx, req.userId);

    const existingByKey = await this.findHoldByCancelKey(tx, req.idempotencyKey);
    if (existingByKey) {
      return {
        resultStatus: existingByKey.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        providerTransactionId: existingByKey.id,
        raw: {
          providerType: 'POINTS',
          operation: 'CANCEL',
          holdId: existingByKey.id,
          idempotentReplay: true,
        },
      };
    }

    const latestHold = await this.findLatestHoldByLegId(tx, req.legId);
    if (!latestHold) {
      return this.failedResult('CANCEL', 'POINT_HOLD_NOT_FOUND', { legId: req.legId });
    }

    if (latestHold.status === 'CANCELLED') {
      return {
        resultStatus: 'CANCELLED',
        providerTransactionId: latestHold.id,
        raw: {
          providerType: 'POINTS',
          operation: 'CANCEL',
          holdId: latestHold.id,
          idempotentReplay: true,
        },
      };
    }

    if (latestHold.status !== 'AUTHORIZED') {
      return this.failedResult('CANCEL', 'POINT_HOLD_NOT_CANCELABLE', {
        holdId: latestHold.id,
        holdStatus: latestHold.status,
      });
    }

    await tx
      .update(pointHolds)
      .set({
        status: 'CANCELLED',
        cancelAttemptId: req.attemptId ?? null,
        cancelProviderIdempotencyKey: req.idempotencyKey,
        updatedAt: new Date(),
      })
      .where(eq(pointHolds.id, latestHold.id));

    return {
      resultStatus: 'CANCELLED',
      providerTransactionId: latestHold.id,
      raw: {
        providerType: 'POINTS',
        operation: 'CANCEL',
        holdId: latestHold.id,
      },
    };
  }

  async refund(
    tx: DbTx,
    req: PointsOperationRequest,
  ): Promise<PointsOperationResult> {
    await this.acquireUserLock(tx, req.userId);

    const existingRefundEvent = await this.findEventByProviderIdempotencyKey(
      tx,
      req.idempotencyKey,
    );
    if (existingRefundEvent) {
      if (existingRefundEvent.eventType === 'REDEEM_CANCEL') {
        return {
          resultStatus: 'REFUNDED',
          providerTransactionId:
            existingRefundEvent.providerTransactionId ?? existingRefundEvent.id,
          raw: {
            providerType: 'POINTS',
            operation: 'REFUND',
            pointEventId: existingRefundEvent.id,
            idempotentReplay: true,
          },
        };
      }
      return this.failedResult('REFUND', 'IDEMPOTENCY_KEY_CONFLICT', {
        idempotencyKey: req.idempotencyKey,
        eventType: existingRefundEvent.eventType,
      });
    }

    const legTotals = await this.readPointLegTotals(tx, req.userId, req.legId);
    const refundableAmount = legTotals.redeemedAmount - legTotals.refundedAmount;

    if (legTotals.redeemedAmount <= 0) {
      return this.failedResult('REFUND', 'NO_CAPTURED_REDEEM', { legId: req.legId });
    }

    if (req.amount > refundableAmount) {
      return this.failedResult('REFUND', 'REFUND_AMOUNT_EXCEEDS_REMAINING', {
        requestedAmount: req.amount,
        refundableAmount,
      });
    }

    const redeemDetails = await this.readRedeemDetails(tx, req.userId, req.legId);
    if (redeemDetails.length === 0) {
      return this.failedResult('REFUND', 'REDEEM_DETAILS_NOT_FOUND', { legId: req.legId });
    }

    const refundedByDetail = await this.readRefundedAmountByRedeemDetailIds(
      tx,
      redeemDetails.map((d) => d.redeemDetailId),
    );

    let remainingAmount = req.amount;
    const detailAllocations: Array<{
      redeemDetailId: string;
      earnedEventDetailId: string;
      amount: number;
    }> = [];

    for (const detail of redeemDetails) {
      if (remainingAmount <= 0) break;
      const refunded = refundedByDetail.get(detail.redeemDetailId) ?? 0;
      const refundableOnDetail = detail.redeemAmount - refunded;
      if (refundableOnDetail <= 0) continue;
      const allocationAmount = Math.min(refundableOnDetail, remainingAmount);
      detailAllocations.push({
        redeemDetailId: detail.redeemDetailId,
        earnedEventDetailId: detail.earnedEventDetailId,
        amount: allocationAmount,
      });
      remainingAmount -= allocationAmount;
    }

    if (remainingAmount > 0) {
      return this.failedResult('REFUND', 'REFUND_DETAIL_ALLOCATION_FAILED', {
        requestedAmount: req.amount,
        remainingAmount,
      });
    }

    const redeemEventRows = await tx
      .select({ id: pointEvents.id })
      .from(pointEvents)
      .where(
        and(
          eq(pointEvents.userId, req.userId),
          eq(pointEvents.legId, req.legId),
          eq(pointEvents.eventType, 'REDEEM'),
        ),
      )
      .orderBy(asc(pointEvents.createdAt))
      .limit(1);

    const originalRedeemEventId = redeemEventRows[0]?.id ?? null;

    const insertedEvents = await tx
      .insert(pointEvents)
      .values({
        userId: req.userId,
        eventType: 'REDEEM_CANCEL',
        amount: req.amount,
        originalEventId: originalRedeemEventId,
        intentId: req.intentId,
        legId: req.legId,
        attemptId: req.attemptId ?? null,
        providerIdempotencyKey: req.idempotencyKey,
        reasonCode: 'POINTS_REFUND_REDEEM_CANCEL',
        reasonMessage: 'Points refund created redeem cancel event',
        metadata: { refundAmount: req.amount },
      })
      .returning({ id: pointEvents.id });

    const refundEvent = insertedEvents[0];
    if (!refundEvent) {
      throw new Error('POINT_REDEEM_CANCEL_EVENT_INSERT_FAILED');
    }

    await tx
      .update(pointEvents)
      .set({ providerTransactionId: refundEvent.id })
      .where(eq(pointEvents.id, refundEvent.id));

    await tx.insert(pointEventDetails).values(
      detailAllocations.map((allocation) => ({
        pointEventId: refundEvent.id,
        userId: req.userId,
        eventType: 'REDEEM_CANCEL' as const,
        amount: allocation.amount,
        earnedEventDetailId: allocation.earnedEventDetailId,
        originalEventDetailId: allocation.redeemDetailId,
      })),
    );

    return {
      resultStatus: 'REFUNDED',
      providerTransactionId: refundEvent.id,
      raw: {
        providerType: 'POINTS',
        operation: 'REFUND',
        pointEventId: refundEvent.id,
        refundedAmount: req.amount,
      },
    };
  }

  private async acquireUserLock(tx: DbTx, userId: string): Promise<void> {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtext('POINTS_LEDGER'),
        hashtext(${userId})
      )
    `);
  }

  private async findHoldByAuthorizeKey(
    tx: DbTx,
    idempotencyKey: string,
  ): Promise<{ id: string; status: 'AUTHORIZED' | 'CAPTURED' | 'CANCELLED' } | undefined> {
    const rows = await tx
      .select({ id: pointHolds.id, status: pointHolds.status })
      .from(pointHolds)
      .where(eq(pointHolds.authorizeProviderIdempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0];
  }

  private async findHoldByCancelKey(
    tx: DbTx,
    idempotencyKey: string,
  ): Promise<{ id: string; status: 'AUTHORIZED' | 'CAPTURED' | 'CANCELLED' } | undefined> {
    const rows = await tx
      .select({ id: pointHolds.id, status: pointHolds.status })
      .from(pointHolds)
      .where(eq(pointHolds.cancelProviderIdempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0];
  }

  private async findLatestHoldByLegId(
    tx: DbTx,
    legId: string,
  ): Promise<
    | {
        id: string;
        userId: string;
        amount: number;
        status: 'AUTHORIZED' | 'CAPTURED' | 'CANCELLED';
        capturedEventId: string | null;
      }
    | undefined
  > {
    const rows = await tx
      .select({
        id: pointHolds.id,
        userId: pointHolds.userId,
        amount: pointHolds.amount,
        status: pointHolds.status,
        capturedEventId: pointHolds.capturedEventId,
      })
      .from(pointHolds)
      .where(eq(pointHolds.legId, legId))
      .orderBy(desc(pointHolds.createdAt))
      .limit(1);
    return rows[0];
  }

  private async findEventByProviderIdempotencyKey(
    tx: DbTx,
    idempotencyKey: string,
  ): Promise<
    | {
        id: string;
        eventType: 'EARN' | 'REDEEM' | 'EARN_CANCEL' | 'REDEEM_CANCEL';
        providerTransactionId: string | null;
      }
    | undefined
  > {
    const rows = await tx
      .select({
        id: pointEvents.id,
        eventType: pointEvents.eventType,
        providerTransactionId: pointEvents.providerTransactionId,
      })
      .from(pointEvents)
      .where(eq(pointEvents.providerIdempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0];
  }

  private async readBalance(
    tx: DbTx,
    userId: string,
  ): Promise<{ confirmedAmount: number; reservedAmount: number; availableAmount: number }> {
    const confirmedRows = await tx
      .select({ amount: sql<number>`coalesce(sum(${pointEvents.amount}), 0)` })
      .from(pointEvents)
      .where(eq(pointEvents.userId, userId));

    const reservedRows = await tx
      .select({ amount: sql<number>`coalesce(sum(${pointHolds.amount}), 0)` })
      .from(pointHolds)
      .where(and(eq(pointHolds.userId, userId), eq(pointHolds.status, 'AUTHORIZED')));

    const confirmedAmount = Number(confirmedRows[0]?.amount ?? 0);
    const reservedAmount = Number(reservedRows[0]?.amount ?? 0);

    return {
      confirmedAmount,
      reservedAmount,
      availableAmount: confirmedAmount - reservedAmount,
    };
  }

  private async readLotAvailability(tx: DbTx, userId: string): Promise<LotAvailabilityRow[]> {
    const rows = (await tx.execute(sql<LotAvailabilityRow>`
      select
        d.earned_event_detail_id as "earnedEventDetailId",
        sum(d.amount)::int as "confirmedAmount",
        coalesce(r.reserved_amount, 0)::int as "reservedAmount"
      from point_event_details d
      left join (
        select
          hd.earned_event_detail_id,
          sum(hd.amount)::int as reserved_amount
        from point_hold_details hd
        join point_holds h on h.id = hd.hold_id
        where h.user_id = ${userId}
          and h.status = 'AUTHORIZED'
        group by hd.earned_event_detail_id
      ) r on r.earned_event_detail_id = d.earned_event_detail_id
      join point_event_details seed_detail on seed_detail.id = d.earned_event_detail_id
      join point_events seed_event on seed_event.id = seed_detail.point_event_id
      where d.user_id = ${userId}
      group by d.earned_event_detail_id, r.reserved_amount
      having sum(d.amount) > 0
      order by min(seed_event.created_at), d.earned_event_detail_id
    `)) as unknown as LotAvailabilityRow[];

    return rows.map((row) => ({
      earnedEventDetailId: row.earnedEventDetailId,
      confirmedAmount: Number(row.confirmedAmount ?? 0),
      reservedAmount: Number(row.reservedAmount ?? 0),
    }));
  }

  private allocateAmountAcrossLots(
    amount: number,
    lotRows: LotAvailabilityRow[],
  ): Array<{ earnedEventDetailId: string; amount: number }> | null {
    let remainingAmount = amount;
    const allocations: Array<{ earnedEventDetailId: string; amount: number }> = [];

    for (const lot of lotRows) {
      if (remainingAmount <= 0) break;
      const availableOnLot = lot.confirmedAmount - lot.reservedAmount;
      if (availableOnLot <= 0) continue;
      const allocationAmount = Math.min(availableOnLot, remainingAmount);
      allocations.push({
        earnedEventDetailId: lot.earnedEventDetailId,
        amount: allocationAmount,
      });
      remainingAmount -= allocationAmount;
    }

    return remainingAmount === 0 ? allocations : null;
  }

  private async readPointLegTotals(
    tx: DbTx,
    userId: string,
    legId: string,
  ): Promise<PointLegTotals> {
    const rows = await tx
      .select({
        redeemedAmount:
          sql<number>`coalesce(sum(case when ${pointEvents.eventType} = 'REDEEM' then -${pointEvents.amount} else 0 end), 0)`,
        refundedAmount:
          sql<number>`coalesce(sum(case when ${pointEvents.eventType} = 'REDEEM_CANCEL' then ${pointEvents.amount} else 0 end), 0)`,
      })
      .from(pointEvents)
      .where(and(eq(pointEvents.userId, userId), eq(pointEvents.legId, legId)));

    return {
      redeemedAmount: Number(rows[0]?.redeemedAmount ?? 0),
      refundedAmount: Number(rows[0]?.refundedAmount ?? 0),
    };
  }

  private async readRedeemDetails(
    tx: DbTx,
    userId: string,
    legId: string,
  ): Promise<RedeemDetailRow[]> {
    const rows = (await tx.execute(sql<RedeemDetailRow>`
      select
        d.id as "redeemDetailId",
        d.earned_event_detail_id as "earnedEventDetailId",
        abs(d.amount)::int as "redeemAmount"
      from point_event_details d
      join point_events e on e.id = d.point_event_id
      where e.user_id = ${userId}
        and e.leg_id = ${legId}
        and e.event_type = 'REDEEM'
      order by d.created_at asc, d.id asc
    `)) as unknown as RedeemDetailRow[];

    return rows.map((row) => ({
      redeemDetailId: row.redeemDetailId,
      earnedEventDetailId: row.earnedEventDetailId,
      redeemAmount: Number(row.redeemAmount ?? 0),
    }));
  }

  private async readRefundedAmountByRedeemDetailIds(
    tx: DbTx,
    redeemDetailIds: string[],
  ): Promise<Map<string, number>> {
    if (redeemDetailIds.length === 0) return new Map();

    const rows = await tx
      .select({
        redeemDetailId: pointEventDetails.originalEventDetailId,
        refundedAmount: sql<number>`coalesce(sum(${pointEventDetails.amount}), 0)`,
      })
      .from(pointEventDetails)
      .where(
        and(
          eq(pointEventDetails.eventType, 'REDEEM_CANCEL'),
          inArray(pointEventDetails.originalEventDetailId, redeemDetailIds),
        ),
      )
      .groupBy(pointEventDetails.originalEventDetailId);

    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.redeemDetailId) continue;
      map.set(row.redeemDetailId, Number(row.refundedAmount ?? 0));
    }
    return map;
  }

  private buildAuthorizeResultFromHold(
    holdId: string,
    status: 'AUTHORIZED' | 'CAPTURED' | 'CANCELLED',
  ): PointsOperationResult {
    if (status === 'AUTHORIZED') {
      return {
        resultStatus: 'AUTHORIZED',
        providerTransactionId: holdId,
        raw: {
          providerType: 'POINTS',
          operation: 'AUTHORIZE',
          holdId,
          idempotentReplay: true,
        },
      };
    }

    if (status === 'CAPTURED') {
      return {
        resultStatus: 'CAPTURED',
        providerTransactionId: holdId,
        raw: {
          providerType: 'POINTS',
          operation: 'AUTHORIZE',
          holdId,
          idempotentReplay: true,
          currentHoldStatus: status,
        },
      };
    }

    return this.failedResult('AUTHORIZE', 'POINT_HOLD_ALREADY_CANCELLED', { holdId });
  }

  private failedResult(
    operation: 'AUTHORIZE' | 'CAPTURE' | 'CANCEL' | 'REFUND',
    reasonCode: string,
    extra: Record<string, unknown> = {},
  ): PointsOperationResult {
    return {
      resultStatus: 'FAILED',
      raw: {
        providerType: 'POINTS',
        operation,
        reasonCode,
        ...extra,
      },
    };
  }
}
