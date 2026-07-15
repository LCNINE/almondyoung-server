import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { DbService } from '@app/db';
import { and, or, eq, lte, gte, isNull, inArray, ne } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { StockStateEnum } from '../../schema/enum-values';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { acquireStockAvailabilityLock } from '../../shared/locks/stock-availability-lock';
import { assertReservationInvariant } from '../../shared/locks/reservation-invariant';
import { BatchControlledStockGuard, BatchSessionDispatchAuthorization } from '../services/batch-controlled-stock.guard';

// TransitionType alias for strong typing
type TransitionType = (typeof wmsTables.stockEvents.$inferInsert)['transitionType'];
type StockEventRow = typeof wmsTables.stockEvents.$inferSelect;

export type ReverseShipmentDispatchEventInput = {
  dispatchAttemptId: string;
  dispatchAttemptSourceId: string;
  originalShipEventId: string;
  reversalJournalId: string;
  recallOperationId: string;
  toLocationId: string;
  occurredAt: Date;
  reason: string;
};

export type ShipmentDispatchEventReversal = {
  dispatchAttemptSourceId: string;
  shipmentLineId: string;
  skuId: string;
  warehouseId: string;
  outboundReworkLocationId: string;
  quantity: number;
  originalEventId: string;
  reversalEventId: string;
};

type CreateEventInput = {
  journalId?: string;
  skuId: string;

  // 전이 방향 (한쪽 또는 양쪽)
  fromWarehouseId?: string | null;
  fromLocationId?: string | null;
  toWarehouseId?: string | null;
  toLocationId?: string | null;

  fromState?: (typeof wmsTables.stockEvents.$inferInsert)['fromState'] | null;
  toState?: (typeof wmsTables.stockEvents.$inferInsert)['toState'] | null;

  transitionType: (typeof wmsTables.stockEvents.$inferInsert)['transitionType'];
  quantity: number; // 항상 양수
  occurredAt: Date; // 비즈니스 발생시각
  idempotencyKey?: string;
  reason?: string;
  batchSessionDispatch?: BatchSessionDispatchAuthorization;
  /**
   * A shipment dispatch removes the matching reservation in the same caller
   * transaction. Publishing between the ledger decrement and that release
   * would expose a transient, incorrect sellable quantity, so the dispatch
   * owner publishes once after both mutations are complete.
   */
  deferSellableProjection?: boolean;
};

@Injectable()
export class StockEventStore {
  private readonly logger = new Logger(StockEventStore.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly productSellableQuantity: ProductSellableQuantityService,
    private readonly batchControlledStock: BatchControlledStockGuard = new BatchControlledStockGuard(),
  ) {}

  private get db() {
    return this.dbService.db;
  }

  // -----------------------------
  // 생성/커밋 (이벤트 + 레저 갱신)
  // -----------------------------

  /** 이벤트 1건 생성 + 레저 프로젝션 갱신(동일 트랜잭션) */
  async createEvent(input: CreateEventInput, tx?: DbTx) {
    if (input.batchSessionDispatch && !tx) {
      throw new Error('batchSessionDispatch requires the caller dispatch transaction');
    }
    if (input.deferSellableProjection && (!input.batchSessionDispatch || !tx)) {
      throw new Error('deferSellableProjection is restricted to a caller-owned batch dispatch transaction');
    }
    return this.dbService.run(async (trx) => {
      // 1) 이벤트 삽입 (멱등키가 있으면 중복 방지)
      const [event] = await trx
        .insert(wmsTables.stockEvents)
        .values({
          journalId: input.journalId ?? null,
          skuId: input.skuId,
          fromWarehouseId: input.fromWarehouseId ?? null,
          fromLocationId: input.fromLocationId ?? null,
          toWarehouseId: input.toWarehouseId ?? null,
          toLocationId: input.toLocationId ?? null,
          fromState: input.fromState ?? null,
          toState: input.toState ?? null,
          transitionType: input.transitionType,
          quantity: input.quantity,
          occurredAt: input.occurredAt,
          idempotencyKey: input.idempotencyKey,
          eventStatus: 'POSTED', // MVP 기본값
          reason: input.reason ?? null,
        })
        .onConflictDoNothing({ target: wmsTables.stockEvents.idempotencyKey }) // 멱등
        .returning();

      if (!event) {
        this.logger.debug(`Idempotent createEvent skipped: ${input.idempotencyKey}`);
        if (input.idempotencyKey) {
          const existing = await trx.query.stockEvents.findFirst({
            where: (e, { eq }) => eq(e.idempotencyKey, input.idempotencyKey!),
          });
          if (existing && input.batchSessionDispatch) {
            await this.assertDispatchReplayAuthorization(input.batchSessionDispatch, existing, trx);
          }
          return existing ?? null;
        }
        return null;
      }

      // This repository is the final write boundary for stock ledger projection.
      // Guard here (after the idempotency claim, before projection) so direct
      // callers cannot bypass batch custody protection and exact replays remain
      // no-ops even if availability changed after the original event.
      await this.assertBatchControlledRemovalAllowed(event, input.batchSessionDispatch, trx);

      // 2) 레저 갱신 (from -= qty, to += qty)
      await this.applyProjection(trx, {
        skuId: event.skuId,
        fromWarehouseId: event.fromWarehouseId,
        fromLocationId: event.fromLocationId,
        toWarehouseId: event.toWarehouseId,
        toLocationId: event.toLocationId,
        fromState: event.fromState,
        toState: event.toState,
        quantity: event.quantity,
      });

      if (!input.deferSellableProjection) {
        await this.productSellableQuantity.recalculateAndPublishForSku(event.skuId, trx);
      }

      this.logger.debug(`Created ${event.transitionType} ev#${event.id} sku=${event.skuId} qty=${event.quantity}`);
      return event;
    }, tx);
  }

  /** 내부용: 레저 가/감산 (음수 금지 정책은 여기서 체크 가능) */
  private async applyProjection(
    tx: DbTx,
    params: {
      skuId: string;
      fromWarehouseId: string | null;
      fromLocationId: string | null;
      toWarehouseId: string | null;
      toLocationId: string | null;
      fromState: StockStateEnum | null;
      toState: StockStateEnum | null;
      quantity: number;
    },
  ) {
    const now = new Date();

    // fromState 감소
    if (params.fromState) {
      if (!params.fromWarehouseId || !params.fromLocationId) {
        throw new BadRequestException('fromState가 있으면 fromWarehouse/Location이 필요합니다.');
      }

      // 음수 INSERT를 금지하고, 충분 수량이 있는 기존 행에 대해서만 조건부 UPDATE 수행
      const decreased = await tx
        .update(wmsTables.stockLedgers)
        .set({
          qty: sql`${wmsTables.stockLedgers.qty} - ${params.quantity}`,
          version: sql`${wmsTables.stockLedgers.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, params.skuId),
            eq(wmsTables.stockLedgers.warehouseId, params.fromWarehouseId),
            eq(wmsTables.stockLedgers.locationId, params.fromLocationId),
            eq(wmsTables.stockLedgers.stockState, params.fromState),
            gte(wmsTables.stockLedgers.qty, params.quantity),
          ),
        )
        .returning();

      if (!decreased || decreased.length === 0) {
        throw new BadRequestException('insufficient on-hand at source');
      }
    }

    // toState 증가
    if (params.toState) {
      if (!params.toWarehouseId || !params.toLocationId) {
        throw new BadRequestException('toState가 있으면 toWarehouse/Location이 필요합니다.');
      }
      await tx
        .insert(wmsTables.stockLedgers)
        .values({
          skuId: params.skuId,
          warehouseId: params.toWarehouseId,
          locationId: params.toLocationId,
          stockState: params.toState,
          qty: params.quantity,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            wmsTables.stockLedgers.skuId,
            wmsTables.stockLedgers.warehouseId,
            wmsTables.stockLedgers.locationId,
            wmsTables.stockLedgers.stockState,
          ],
          set: {
            qty: sql`${wmsTables.stockLedgers.qty} + ${params.quantity}`,
            version: sql`${wmsTables.stockLedgers.version} + 1`,
            updatedAt: now,
          },
        });
    }
  }

  // -----------------------------
  // 조회
  // -----------------------------

  /** 이벤트 이력 (SKU 중심, 특정 창고의 from/to 모두 포함) */
  async getEventHistory(skuId?: string, warehouseId?: string, startDate?: string, endDate?: string) {
    const where = (e: typeof wmsTables.stockEvents) =>
      and(
        skuId ? eq(e.skuId, skuId) : undefined,
        warehouseId ? or(eq(e.fromWarehouseId, warehouseId), eq(e.toWarehouseId, warehouseId)) : undefined,
        startDate ? gte(e.occurredAt, new Date(startDate)) : undefined,
        endDate ? lte(e.occurredAt, new Date(new Date(endDate).setHours(23, 59, 59, 999))) : undefined,
        eq(e.eventStatus, 'POSTED'),
        isNull(e.voidedByEventId),
      );

    return this.db.query.stockEvents.findMany({
      where,
      orderBy: (e, { asc }) => [asc(e.occurredAt)],
    });
  }

  /** 특정 시점(as-of)의 수량 (그레인=창고/로케/상태) */
  async calculateQuantityAsOf(params: {
    skuId: string;
    warehouseId: string;
    locationId: string;
    state: (typeof wmsTables.stockLedgers.$inferSelect)['stockState'];
    at: Date;
  }): Promise<number> {
    const { skuId, warehouseId, locationId, state, at } = params;

    const [row] = await this.db
      .select({
        qtyAsOf: sql<number>`
          coalesce(sum(
            case when ${wmsTables.stockEvents.toState} = ${state}
               and ${wmsTables.stockEvents.toWarehouseId} = ${warehouseId}
               and ${wmsTables.stockEvents.toLocationId} = ${locationId}
             then ${wmsTables.stockEvents.quantity} else 0 end
          ),0)
          -
          coalesce(sum(
            case when ${wmsTables.stockEvents.fromState} = ${state}
               and ${wmsTables.stockEvents.fromWarehouseId} = ${warehouseId}
               and ${wmsTables.stockEvents.fromLocationId} = ${locationId}
             then ${wmsTables.stockEvents.quantity} else 0 end
          ),0)
        `,
      })
      .from(wmsTables.stockEvents)
      .where(
        and(
          eq(wmsTables.stockEvents.skuId, skuId),
          lte(wmsTables.stockEvents.occurredAt, at),
          eq(wmsTables.stockEvents.eventStatus, 'POSTED'),
          isNull(wmsTables.stockEvents.voidedByEventId),
        ),
      );

    return row?.qtyAsOf ?? 0;
  }

  /** 이벤트 통계 (전이 타입별 카운트/합계) */
  async getEventStatistics(params: { skuId: string; warehouseId?: string; startDate?: Date; endDate?: Date }) {
    const { skuId, warehouseId, startDate, endDate } = params;

    const events = await this.db.query.stockEvents.findMany({
      where: (e, { and, or, eq, gte, lte, isNull }) =>
        and(
          eq(e.skuId, skuId),
          warehouseId ? or(eq(e.fromWarehouseId, warehouseId), eq(e.toWarehouseId, warehouseId)) : undefined,
          startDate ? gte(e.occurredAt, startDate) : undefined,
          endDate ? lte(e.occurredAt, endDate) : undefined,
          eq(e.eventStatus, 'POSTED'),
          isNull(e.voidedByEventId),
        ),
    });

    const byType: Record<string, { count: number; totalQty: number }> = {};
    for (const ev of events) {
      const k = ev.transitionType as string;
      if (!byType[k]) byType[k] = { count: 0, totalQty: 0 };
      byType[k].count += 1;
      byType[k].totalQty += ev.quantity;
    }

    return {
      skuId,
      warehouseId: warehouseId ?? null,
      totalEvents: events.length,
      byTransitionType: byType,
    };
  }

  /** 최근 이벤트 (특정 창고 관점이면 from/to 모두 포함) */
  async getRecentEvents(limit = 100, warehouseId?: string) {
    return this.db.query.stockEvents.findMany({
      where: (e, { or, eq, isNull }) =>
        warehouseId
          ? and(
              or(eq(e.fromWarehouseId, warehouseId), eq(e.toWarehouseId, warehouseId)),
              eq(e.eventStatus, 'POSTED'),
              isNull(e.voidedByEventId),
            )
          : and(eq(e.eventStatus, 'POSTED'), isNull(e.voidedByEventId)),
      orderBy: (e, { desc }) => [desc(e.occurredAt)],
      limit,
      with: {
        sku: true,
      },
    });
  }

  // -----------------------------
  // 정정(역분개)
  // -----------------------------

  /**
   * Reverse one exact shipment-dispatch source into OUTBOUND_REWORK.
   *
   * This deliberately does not publish a sellable projection. Recall restores
   * the matching shipment-line reservation in the same caller transaction and
   * publishes only after both on-hand and reserved have increased, preserving
   * the available-quantity invariant.
   */
  async reverseShipmentDispatchEvent(
    input: ReverseShipmentDispatchEventInput,
    tx: DbTx,
  ): Promise<ShipmentDispatchEventReversal> {
    if (!tx) throw new Error('Shipment dispatch reversal requires the caller recall transaction');

    const [attempt] = await tx
      .select({
        id: wmsTables.dispatchAttempts.id,
        shipmentId: wmsTables.dispatchAttempts.shipmentId,
        status: wmsTables.dispatchAttempts.status,
        stockJournalId: wmsTables.dispatchAttempts.stockJournalId,
        reversalJournalId: wmsTables.dispatchAttempts.reversalJournalId,
      })
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.id, input.dispatchAttemptId))
      .limit(1)
      .for('update');
    if (!attempt || !['dispatched', 'recovery_required'].includes(attempt.status)) {
      throw this.shipmentDispatchReversalConflict(
        'SHIPMENT_DISPATCH_REVERSAL_ATTEMPT_INVALID',
        'Dispatch attempt is not eligible for stock reversal',
      );
    }
    if (!attempt.stockJournalId || attempt.reversalJournalId) {
      throw this.shipmentDispatchReversalConflict(
        'SHIPMENT_DISPATCH_ALREADY_REVERSED',
        'Dispatch attempt already owns a reversal journal or has no dispatch journal',
      );
    }

    const [reversalJournal] = await tx
      .select({
        id: wmsTables.stockJournals.id,
        sourceType: wmsTables.stockJournals.sourceType,
        sourceId: wmsTables.stockJournals.sourceId,
      })
      .from(wmsTables.stockJournals)
      .where(eq(wmsTables.stockJournals.id, input.reversalJournalId))
      .limit(1)
      .for('update');
    if (
      !reversalJournal ||
      reversalJournal.sourceType !== 'SHIPMENT_RECALL' ||
      reversalJournal.sourceId !== input.recallOperationId ||
      reversalJournal.id === attempt.stockJournalId
    ) {
      throw this.shipmentDispatchReversalConflict(
        'SHIPMENT_DISPATCH_REVERSAL_JOURNAL_INVALID',
        'Reversal journal is not owned by the exact recall operation',
      );
    }

    const [lockedSource] = await tx
      .select({
        id: wmsTables.dispatchAttemptSources.id,
        dispatchAttemptId: wmsTables.dispatchAttemptSources.dispatchAttemptId,
        shipmentLineId: wmsTables.dispatchAttemptSources.shipmentLineId,
        sourceLocationId: wmsTables.dispatchAttemptSources.sourceLocationId,
        qty: wmsTables.dispatchAttemptSources.qty,
        stockEventId: wmsTables.dispatchAttemptSources.stockEventId,
      })
      .from(wmsTables.dispatchAttemptSources)
      .where(
        and(
          eq(wmsTables.dispatchAttemptSources.id, input.dispatchAttemptSourceId),
          eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempt.id),
        ),
      )
      .limit(1)
      .for('update');
    const [sourceIdentity] = lockedSource
      ? await tx
          .select({
            lineShipmentId: wmsTables.shipmentLines.shipmentId,
            skuId: wmsTables.shipmentLines.skuId,
            warehouseId: wmsTables.shipments.warehouseId,
          })
          .from(wmsTables.shipmentLines)
          .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
          .where(eq(wmsTables.shipmentLines.id, lockedSource.shipmentLineId))
          .limit(1)
      : [];
    const source = lockedSource && sourceIdentity ? { ...lockedSource, ...sourceIdentity } : null;
    if (
      !source ||
      source.lineShipmentId !== attempt.shipmentId ||
      !source.stockEventId ||
      source.stockEventId !== input.originalShipEventId
    ) {
      throw this.shipmentDispatchReversalConflict(
        'SHIPMENT_DISPATCH_REVERSAL_SOURCE_INVALID',
        'Dispatch source does not belong to the exact attempt event',
      );
    }

    const [original] = await tx
      .select()
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.id, input.originalShipEventId))
      .limit(1)
      .for('update');
    const [reworkLocation] = await tx
      .select({ id: wmsTables.locations.id })
      .from(wmsTables.locations)
      .where(
        and(
          eq(wmsTables.locations.id, input.toLocationId),
          eq(wmsTables.locations.warehouseId, source.warehouseId),
          eq(wmsTables.locations.systemRole, 'outbound_rework'),
          eq(wmsTables.locations.isSystem, true),
          eq(wmsTables.locations.isActive, true),
        ),
      )
      .limit(1);
    if (!reworkLocation) {
      throw this.shipmentDispatchReversalConflict(
        'SHIPMENT_DISPATCH_REVERSAL_DESTINATION_INVALID',
        'Stock reversal destination must be the active warehouse OUTBOUND_REWORK location',
      );
    }
    if (
      !original ||
      original.journalId !== attempt.stockJournalId ||
      original.skuId !== source.skuId ||
      original.fromWarehouseId !== source.warehouseId ||
      original.fromLocationId !== source.sourceLocationId ||
      original.fromState !== 'ON_HAND' ||
      original.toWarehouseId !== null ||
      original.toLocationId !== null ||
      original.toState !== null ||
      original.transitionType !== 'SHIP' ||
      original.quantity !== source.qty ||
      original.eventStatus !== 'POSTED' ||
      original.voidedByEventId !== null
    ) {
      throw this.shipmentDispatchReversalConflict(
        'SHIPMENT_DISPATCH_REVERSAL_EVENT_INVALID',
        'Original stock event is not the exact posted economic dispatch source',
      );
    }

    const [existingReversal] = await tx
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.reversalOfEventId, original.id))
      .limit(1);
    if (existingReversal) {
      throw this.shipmentDispatchReversalConflict(
        'SHIPMENT_DISPATCH_ALREADY_REVERSED',
        'Dispatch stock event has already been reversed',
      );
    }

    const [reversal] = await tx
      .insert(wmsTables.stockEvents)
      .values({
        journalId: input.reversalJournalId,
        skuId: original.skuId,
        fromWarehouseId: null,
        fromLocationId: null,
        toWarehouseId: source.warehouseId,
        toLocationId: reworkLocation.id,
        fromState: null,
        toState: 'ON_HAND',
        transitionType: 'ADJUST_UP',
        quantity: original.quantity,
        occurredAt: input.occurredAt,
        idempotencyKey: `recall:${input.recallOperationId}:${source.id}`,
        eventStatus: 'POSTED',
        reversalOfEventId: original.id,
        reason: `Recall ${input.recallOperationId}: ${input.reason}`.slice(0, 255),
      })
      .returning();

    await this.applyProjection(tx, {
      skuId: reversal.skuId,
      fromWarehouseId: reversal.fromWarehouseId,
      fromLocationId: reversal.fromLocationId,
      toWarehouseId: reversal.toWarehouseId,
      toLocationId: reversal.toLocationId,
      fromState: reversal.fromState,
      toState: reversal.toState,
      quantity: reversal.quantity,
    });

    this.logger.log(`Reversed dispatch event#${original.id} into OUTBOUND_REWORK with event#${reversal.id}`);
    return {
      dispatchAttemptSourceId: source.id,
      shipmentLineId: source.shipmentLineId,
      skuId: source.skuId,
      warehouseId: source.warehouseId,
      outboundReworkLocationId: reworkLocation.id,
      quantity: source.qty,
      originalEventId: original.id,
      reversalEventId: reversal.id,
    };
  }

  /** 이벤트 역분개(취소): 원 이벤트의 효과를 상쇄하는 반대 이벤트 생성 */
  async reverseEvent(eventId: string, reason: string, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const [original] = await trx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, eventId))
        .limit(1)
        .for('update');
      if (!original) throw new BadRequestException(`Event ${eventId} not found`);
      if (original.eventStatus !== 'POSTED') {
        throw new BadRequestException('PENDING/VOIDED 이벤트는 역분개할 수 없습니다.');
      }
      const [dispatchSource] = await trx
        .select({ id: wmsTables.dispatchAttemptSources.id })
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.stockEventId, original.id))
        .limit(1);
      if (dispatchSource) {
        throw this.shipmentDispatchReversalConflict(
          'SHIPMENT_DISPATCH_REVERSAL_REQUIRES_RECALL',
          'Shipment dispatch events can only be reversed through the exact recall operation',
        );
      }
      const [existingReversal] = await trx
        .select({ id: wmsTables.stockEvents.id })
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.reversalOfEventId, original.id))
        .limit(1);
      if (existingReversal) {
        throw this.shipmentDispatchReversalConflict(
          'STOCK_EVENT_ALREADY_REVERSED',
          `Event ${eventId} has already been reversed`,
        );
      }

      // 역분개가 ON_HAND 를 순감소시키면(RECEIVE/ADJUST_UP 등 취소) 예약 불변식 가드.
      // 락·가드는 감소 방향만 — 증가·창고내이동(net-0)은 면제(작업 10 §5 락 면제 경로와 일관).
      const dec = reversalOnHandDecrement(original);
      if (dec) {
        await acquireStockAvailabilityLock(trx, dec.skuId, dec.warehouseId);
        await assertReservationInvariant(trx, dec.skuId, dec.warehouseId, dec.quantity);
      }

      // Warehouse-net-zero reversal can still move an exact source location.
      // Batch custody is location-grained, so protect every reverse ON_HAND
      // source even when the warehouse reservation invariant is exempt.
      if (original.toState === 'ON_HAND' && original.toWarehouseId && original.toLocationId) {
        await acquireStockAvailabilityLock(trx, original.skuId, original.toWarehouseId);
        await this.batchControlledStock.assertRemovalAllowed(
          {
            skuId: original.skuId,
            warehouseId: original.toWarehouseId,
            sourceLocationId: original.toLocationId,
            quantity: original.quantity,
          },
          trx,
        );
      }

      // 전이 타입 역매핑
      const reverseType = this.getReversalType(original.transitionType);

      const [rev] = await trx
        .insert(wmsTables.stockEvents)
        .values({
          journalId: original.journalId,
          skuId: original.skuId,

          // 방향 반전: to → from, from → to
          fromWarehouseId: original.toWarehouseId,
          fromLocationId: original.toLocationId,
          toWarehouseId: original.fromWarehouseId,
          toLocationId: original.fromLocationId,

          fromState: original.toState,
          toState: original.fromState,
          transitionType: reverseType,

          quantity: original.quantity,
          occurredAt: new Date(),
          eventStatus: 'POSTED',
          reversalOfEventId: original.id,
          reason: `REVERSAL of ${original.id}: ${reason}`,
        })
        .returning();

      await this.applyProjection(trx, {
        skuId: rev.skuId,
        fromWarehouseId: rev.fromWarehouseId,
        fromLocationId: rev.fromLocationId,
        toWarehouseId: rev.toWarehouseId,
        toLocationId: rev.toLocationId,
        fromState: rev.fromState,
        toState: rev.toState,
        quantity: rev.quantity,
      });

      await this.productSellableQuantity.recalculateAndPublishForSku(rev.skuId, trx);

      this.logger.log(`Reversed event#${eventId} with new event#${rev.id} (${reverseType})`);
      return rev;
    }, tx);
  }

  private async assertBatchControlledRemovalAllowed(
    event: StockEventRow,
    authorization: BatchSessionDispatchAuthorization | undefined,
    tx: DbTx,
  ): Promise<void> {
    if (event.fromState !== 'ON_HAND' || !event.fromWarehouseId || !event.fromLocationId) {
      if (authorization) {
        throw this.batchDispatchConflict(
          'BATCH_DISPATCH_EVENT_MISMATCH',
          'Dispatch authorization requires ON_HAND removal',
        );
      }
      return;
    }
    if (authorization) {
      await this.authorizeAndLinkBatchSessionDispatch(authorization, event, tx);
      return;
    }
    await acquireStockAvailabilityLock(tx, event.skuId, event.fromWarehouseId);
    await this.batchControlledStock.assertRemovalAllowed(
      {
        skuId: event.skuId,
        warehouseId: event.fromWarehouseId,
        sourceLocationId: event.fromLocationId,
        quantity: event.quantity,
      },
      tx,
    );
  }

  private async authorizeAndLinkBatchSessionDispatch(
    authorization: BatchSessionDispatchAuthorization,
    event: StockEventRow,
    tx: DbTx,
  ): Promise<void> {
    const source = await this.lockDispatchSource(authorization.dispatchAttemptSourceId, tx);
    if (
      !source ||
      source.stockEventId !== null ||
      source.attemptStatus !== 'pending' ||
      !source.attemptJournalId ||
      source.attemptJournalId !== event.journalId ||
      source.lineShipmentId !== source.attemptShipmentId ||
      source.lineSkuId !== event.skuId ||
      source.warehouseId !== event.fromWarehouseId ||
      source.sourceLocationId !== event.fromLocationId ||
      source.qty !== event.quantity ||
      event.fromState !== 'ON_HAND' ||
      event.toWarehouseId !== null ||
      event.toLocationId !== null ||
      event.toState !== null ||
      event.transitionType !== 'SHIP'
    ) {
      throw this.batchDispatchConflict(
        'BATCH_DISPATCH_SOURCE_MISMATCH',
        'Dispatch authorization does not match the pending exact stock source',
      );
    }

    // Canonical dispatch owns attempt/source before it reaches the stock
    // boundary. Preserve that order here, then take the shared stock advisory
    // lock; never take shipment/line locks from this low-level repository.
    await acquireStockAvailabilityLock(tx, event.skuId, event.fromWarehouseId);
    const availability = await this.batchControlledStock.getAvailability(
      {
        skuId: event.skuId,
        warehouseId: event.fromWarehouseId,
        sourceLocationId: event.fromLocationId,
      },
      tx,
      { lock: true },
    );
    if (availability.onHandQty < event.quantity || availability.onHandQty < availability.batchControlledQty) {
      throw this.batchDispatchConflict(
        'BATCH_DISPATCH_STOCK_DRIFT',
        'Controlled source ledger is insufficient or already below custody balance',
      );
    }

    const [custody] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .innerJoin(
        wmsTables.batchInventorySessions,
        eq(wmsTables.batchInventorySessions.id, wmsTables.batchInventorySessionBalances.sessionId),
      )
      .where(
        and(
          eq(wmsTables.batchInventorySessions.id, authorization.sessionId),
          eq(wmsTables.batchInventorySessions.status, 'active'),
          eq(wmsTables.batchInventorySessionBalances.skuId, event.skuId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, source.sourceLocationId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, source.shipmentLineId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
          inArray(wmsTables.batchInventorySessionBalances.custodyType, [
            'WORKER',
            'TOTE',
            'SORTING',
            'PACKING',
            'PACKED',
          ]),
        ),
      );
    if (Number(custody?.qty ?? 0) !== event.quantity) {
      throw this.batchDispatchConflict(
        'BATCH_DISPATCH_CUSTODY_MISMATCH',
        'Dispatch source is not backed by exact active shipment-line custody',
      );
    }

    const [linked] = await tx
      .update(wmsTables.dispatchAttemptSources)
      .set({ stockEventId: event.id })
      .where(
        and(
          eq(wmsTables.dispatchAttemptSources.id, authorization.dispatchAttemptSourceId),
          isNull(wmsTables.dispatchAttemptSources.stockEventId),
        ),
      )
      .returning({ id: wmsTables.dispatchAttemptSources.id });
    if (!linked) {
      throw this.batchDispatchConflict(
        'BATCH_DISPATCH_SOURCE_ALREADY_USED',
        'Dispatch source already owns a stock event',
      );
    }
  }

  private async assertDispatchReplayAuthorization(
    authorization: BatchSessionDispatchAuthorization,
    event: StockEventRow,
    tx: DbTx,
  ): Promise<void> {
    const source = await this.lockDispatchSource(authorization.dispatchAttemptSourceId, tx);
    if (
      !source ||
      source.stockEventId !== event.id ||
      source.attemptJournalId !== event.journalId ||
      source.lineShipmentId !== source.attemptShipmentId ||
      source.lineSkuId !== event.skuId ||
      source.warehouseId !== event.fromWarehouseId ||
      source.sourceLocationId !== event.fromLocationId ||
      source.qty !== event.quantity ||
      event.fromState !== 'ON_HAND' ||
      event.toWarehouseId !== null ||
      event.toLocationId !== null ||
      event.toState !== null ||
      event.transitionType !== 'SHIP'
    ) {
      throw this.batchDispatchConflict(
        'BATCH_DISPATCH_REPLAY_MISMATCH',
        'Dispatch replay authorization does not own the existing stock event',
      );
    }

    const [activeCustody] = await tx
      .select({ id: wmsTables.batchInventorySessionBalances.id })
      .from(wmsTables.batchInventorySessionBalances)
      .innerJoin(
        wmsTables.batchInventorySessions,
        eq(wmsTables.batchInventorySessions.id, wmsTables.batchInventorySessionBalances.sessionId),
      )
      .where(
        and(
          eq(wmsTables.batchInventorySessions.id, authorization.sessionId),
          eq(wmsTables.batchInventorySessions.status, 'active'),
          eq(wmsTables.batchInventorySessionBalances.skuId, event.skuId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, source.sourceLocationId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, source.shipmentLineId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      )
      .limit(1);
    const [settlement] = activeCustody
      ? []
      : await tx
          .select({ id: wmsTables.batchInventorySessionEvents.id })
          .from(wmsTables.batchInventorySessionEvents)
          .where(
            and(
              eq(wmsTables.batchInventorySessionEvents.sessionId, authorization.sessionId),
              eq(wmsTables.batchInventorySessionEvents.eventType, 'SETTLE_FOR_DISPATCH'),
              sql`${wmsTables.batchInventorySessionEvents.payload}->>'dispatchAttemptSourceId' = ${authorization.dispatchAttemptSourceId}`,
            ),
          )
          .limit(1);
    if (!activeCustody && !settlement) {
      throw this.batchDispatchConflict(
        'BATCH_DISPATCH_SESSION_MISMATCH',
        'Dispatch replay authorization belongs to another custody session',
      );
    }
  }

  private async lockDispatchSource(dispatchAttemptSourceId: string, tx: DbTx) {
    const [identity] = await tx
      .select({
        id: wmsTables.dispatchAttemptSources.id,
        dispatchAttemptId: wmsTables.dispatchAttemptSources.dispatchAttemptId,
      })
      .from(wmsTables.dispatchAttemptSources)
      .where(eq(wmsTables.dispatchAttemptSources.id, dispatchAttemptSourceId))
      .limit(1);
    if (!identity) return null;

    const [attempt] = await tx
      .select({ id: wmsTables.dispatchAttempts.id })
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.id, identity.dispatchAttemptId))
      .limit(1)
      .for('update');
    if (!attempt) return null;

    const [lockedSource] = await tx
      .select({ id: wmsTables.dispatchAttemptSources.id })
      .from(wmsTables.dispatchAttemptSources)
      .where(
        and(
          eq(wmsTables.dispatchAttemptSources.id, dispatchAttemptSourceId),
          eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempt.id),
        ),
      )
      .limit(1)
      .for('update');
    if (!lockedSource) return null;

    const [source] = await tx
      .select({
        id: wmsTables.dispatchAttemptSources.id,
        qty: wmsTables.dispatchAttemptSources.qty,
        sourceLocationId: wmsTables.dispatchAttemptSources.sourceLocationId,
        shipmentLineId: wmsTables.dispatchAttemptSources.shipmentLineId,
        stockEventId: wmsTables.dispatchAttemptSources.stockEventId,
        attemptStatus: wmsTables.dispatchAttempts.status,
        attemptJournalId: wmsTables.dispatchAttempts.stockJournalId,
        attemptShipmentId: wmsTables.dispatchAttempts.shipmentId,
        lineShipmentId: wmsTables.shipmentLines.shipmentId,
        lineSkuId: wmsTables.shipmentLines.skuId,
        warehouseId: wmsTables.shipments.warehouseId,
      })
      .from(wmsTables.dispatchAttemptSources)
      .innerJoin(
        wmsTables.dispatchAttempts,
        eq(wmsTables.dispatchAttempts.id, wmsTables.dispatchAttemptSources.dispatchAttemptId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.dispatchAttemptSources.shipmentLineId),
      )
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.dispatchAttempts.shipmentId))
      .where(eq(wmsTables.dispatchAttemptSources.id, dispatchAttemptSourceId))
      .limit(1);
    return source ?? null;
  }

  private batchDispatchConflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private shipmentDispatchReversalConflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private getReversalType(t: TransitionType): TransitionType {
    const map: Record<TransitionType, TransitionType> = {
      // 기본 흐름
      RECEIVE: 'ADJUST_DOWN',
      SHIP: 'ADJUST_UP',
      MOVE: 'MOVE', // 이동은 반대 방향 이동으로 역분개

      // 품질 관리
      MARK_DEFECT: 'REWORK_GOOD',
      REWORK_GOOD: 'MARK_DEFECT',
      SCRAP: 'ADJUST_UP', // 폐기 취소는 재고 증가

      // 수동 조정
      ADJUST_UP: 'ADJUST_DOWN',
      ADJUST_DOWN: 'ADJUST_UP',
    } as const;
    return map[t] ?? 'ADJUST_DOWN';
  }
}

/**
 * 역분개가 창고 ON_HAND 를 순감소시키는지 판정.
 * reverseEvent 는 원 이벤트의 to-측을 from-측(감소)으로 반전한다. 따라서 ON_HAND 순감소 창고 =
 * original.toWarehouseId (original.toState === 'ON_HAND' 일 때). 창고내 이동(from==to, 양쪽 ON_HAND)은
 * 순변화 0 → 제외. 증가/비-ON_HAND 방향(SHIP·ADJUST_DOWN·SCRAP 역분개 등)은 null → 락·가드 면제.
 */
export function reversalOnHandDecrement(original: {
  skuId: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromState: StockStateEnum | null;
  toState: StockStateEnum | null;
  quantity: number;
}): { skuId: string; warehouseId: string; quantity: number } | null {
  if (original.toState !== 'ON_HAND' || original.toWarehouseId == null) return null;
  if (original.fromState === 'ON_HAND' && original.fromWarehouseId === original.toWarehouseId) return null;
  return { skuId: original.skuId, warehouseId: original.toWarehouseId, quantity: original.quantity };
}
