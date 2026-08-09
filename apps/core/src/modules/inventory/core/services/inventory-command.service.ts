import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import { InjectPublisher, PublisherFor } from '@app/events';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { ShipmentDispatchEventReversal, StockEventStore } from '../repositories/stock-event.store';
import { LocationService } from './location.service';
import { eq, and, gt, asc } from 'drizzle-orm';
import { acquireStockAvailabilityLock } from '../../shared/locks/stock-availability-lock';
import { assertReservationInvariant } from '../../shared/locks/reservation-invariant';
import { BatchControlledStockGuard, BatchSessionDispatchAuthorization } from './batch-controlled-stock.guard';

@Injectable()
export class InventoryCommandService {
  private readonly logger = new Logger(InventoryCommandService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly eventStore: StockEventStore,
    @InjectPublisher(INVENTORY_STREAM)
    private readonly inventory: PublisherFor<typeof INVENTORY_STREAM>,
    private readonly locationService: LocationService,
    private readonly batchControlledStock: BatchControlledStockGuard = new BatchControlledStockGuard(),
  ) {}

  /**
   * adjustUp/adjustDown 조기 멱등 흡수용. `StockEventStore.createEvent` 의 unique
   * dedupe 는 그대로 최종 백스탑으로 남기되, 여기서 먼저 걸러 재시도가 (이미
   * 변한) ledger 를 다시 읽고 가드/부족검증을 통과하려다 실패하는 일을 막는다.
   * ledger·outbox·가드는 전혀 건드리지 않는다.
   */
  private async findEventIdByIdempotencyKey(trx: DbTx, idempotencyKey: string): Promise<string | null> {
    const [existing] = await trx
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.idempotencyKey, idempotencyKey))
      .limit(1);
    return existing?.id ?? null;
  }

  async receive(
    input: {
      skuId: string;
      toWarehouseId: string;
      toLocationId?: string | null;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
      journalId?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      // 1. SKU 정보 조회
      const sku = await trx.query.skus.findFirst({
        where: (s, { eq }) => eq(s.id, input.skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${input.skuId}`);
      }

      // 2. 현재 재고 조회
      const currentStock = await trx.query.stockLedgers.findFirst({
        where: (l, { eq, and }) =>
          and(
            eq(l.skuId, input.skuId),
            eq(l.warehouseId, input.toWarehouseId),
            eq(l.locationId, input.toLocationId ?? ''),
            eq(l.stockState, 'ON_HAND'),
          ),
      });

      const currentQuantity = currentStock?.qty ?? 0;
      const afterQuantity = currentQuantity + input.quantity;

      // 3. Stock Event 생성
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          toWarehouseId: input.toWarehouseId,
          toLocationId: input.toLocationId ?? null,
          toState: 'ON_HAND',
          transitionType: 'RECEIVE',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          journalId: input.journalId,
        },
        trx,
      );

      if (!event) {
        throw new BadRequestException('Failed to create stock event');
      }

      // 4. Outbox 적재 없음 — 계약을 만족한 적이 없어 Kafka 로 나간 적도 없다
      //    (ADR-0029 §5-1, Task 6-C-2). 아래 `ship()` 의 같은 주석 참조.

      this.logger.log(`RECEIVE: sku=${sku.name} qty=${input.quantity} (${currentQuantity} → ${afterQuantity})`);

      return { eventId: event?.id ?? null };
    };
    return this.dbService.run(exec, tx);
  }

  async ship(
    input: {
      skuId: string;
      warehouseId: string;
      locationId?: string | null;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
      journalId?: string;
      batchSessionDispatch?: BatchSessionDispatchAuthorization;
      deferSellableProjection?: boolean;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    if (input.batchSessionDispatch && !tx) {
      throw new Error('batchSessionDispatch requires the caller dispatch transaction');
    }
    if (input.deferSellableProjection && (!input.batchSessionDispatch || !tx)) {
      throw new Error('deferSellableProjection is restricted to a caller-owned batch dispatch transaction');
    }
    const exec = async (trx: DbTx) => {
      // 1. SKU 정보 조회
      const sku = await trx.query.skus.findFirst({
        where: (s, { eq }) => eq(s.id, input.skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${input.skuId}`);
      }

      // 2. 현재 재고 조회
      const currentStock = await trx.query.stockLedgers.findFirst({
        where: (l, { eq, and }) =>
          and(
            eq(l.skuId, input.skuId),
            eq(l.warehouseId, input.warehouseId),
            eq(l.locationId, input.locationId ?? ''),
            eq(l.stockState, 'ON_HAND'),
          ),
      });

      const currentQuantity = currentStock?.qty ?? 0;
      const afterQuantity = Math.max(0, currentQuantity - input.quantity);

      // 3. Stock Event 생성
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          fromWarehouseId: input.warehouseId,
          fromLocationId: input.locationId ?? null,
          fromState: 'ON_HAND', // 예약 없이 직접 출고
          transitionType: 'SHIP',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          journalId: input.journalId,
          batchSessionDispatch: input.batchSessionDispatch,
          deferSellableProjection: input.deferSellableProjection,
        },
        trx,
      );

      if (!event) {
        throw new BadRequestException('Failed to create stock event');
      }

      // 4. Outbox 적재 — **배치 출고 경로만이다** (ADR-0029 §5-1, Task 6-C-2).
      //
      // 비-batch 갈래도 예전에는 `StockShipped` 를 적재했으나, 그 payload 는 계약
      // (`StockShippedSchema`)을 만족한 적이 없다 — `stockEventId`·`outboundType`·`shippedAt`
      // 이 없고 대신 `afterQuantity`·`journalId`·`occurredAt` 을 실었다. 발행 경로는 zod 를
      // 타므로 그 행들은 적재 → 재시도 5회 → `failed` 로 끝났다. **Kafka 로 나간 적이 없고
      // 소비자도 0곳**이라(이 스트림의 유일한 소비자는 `ProductSellableQuantityChanged`),
      // 적재를 멈추는 것의 관측 가능한 변화는 poison 행이 더 이상 쌓이지 않는 것뿐이다.
      // 되살릴 때는 payload 를 계약에 맞춰 채우는 것이 아니라 **계약을 먼저 정한다**.
      if (input.batchSessionDispatch) {
        await this.inventory.enqueue(
          {
            eventType: 'StockShipped',
            aggregateId: event.id,
            partitionKey: input.skuId,
            idempotencyKey: `stock-event:${event.id}`,
            payload: {
              stockEventId: event.id,
              skuId: event.skuId,
              skuCode: sku.name,
              quantity: event.quantity,
              warehouseId: event.fromWarehouseId!,
              locationId: event.fromLocationId!,
              outboundType: 'ORDER',
              shippedAt: event.occurredAt.toISOString(),
              reason: event.reason ?? undefined,
            },
          },
          trx,
        );
      }

      this.logger.log(`SHIP: sku=${sku.name} qty=${input.quantity} (${currentQuantity} → ${afterQuantity})`);

      return { eventId: event?.id ?? null };
    };
    return this.dbService.run(exec, tx);
  }

  /**
   * Reverse every exact stock source owned by a dispatch attempt. The caller
   * must restore the matching shipment-line reservations and publish the final
   * sellable projection in this same transaction.
   */
  async reverseShipmentDispatch(
    input: {
      dispatchAttemptId: string;
      reversalJournalId: string;
      recallOperationId: string;
      actorId: string;
      reason: string;
      occurredAt?: Date;
    },
    tx: DbTx,
  ): Promise<{
    reversalJournalId: string;
    sources: ShipmentDispatchEventReversal[];
    affectedSkuIds: string[];
  }> {
    if (!tx) throw new Error('Shipment dispatch reversal requires the caller recall transaction');
    if (!input.reason.trim()) throw new BadRequestException('reason is required');

    const [journal] = await tx
      .select({
        id: wmsTables.stockJournals.id,
        sourceType: wmsTables.stockJournals.sourceType,
        sourceId: wmsTables.stockJournals.sourceId,
        actorId: wmsTables.stockJournals.actorId,
      })
      .from(wmsTables.stockJournals)
      .where(eq(wmsTables.stockJournals.id, input.reversalJournalId))
      .limit(1);
    if (
      !journal ||
      journal.sourceType !== 'SHIPMENT_RECALL' ||
      journal.sourceId !== input.recallOperationId ||
      journal.actorId !== input.actorId
    ) {
      throw new BadRequestException('Reversal journal is not owned by the exact recall operation and actor');
    }

    const [attemptWarehouse] = await tx
      .select({ warehouseId: wmsTables.shipments.warehouseId })
      .from(wmsTables.dispatchAttempts)
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.dispatchAttempts.shipmentId))
      .where(eq(wmsTables.dispatchAttempts.id, input.dispatchAttemptId))
      .limit(1);
    if (!attemptWarehouse) throw new BadRequestException('Dispatch attempt not found');
    const reworkLocation = await this.locationService.getSystemLocationByRole(
      attemptWarehouse.warehouseId,
      'outbound_rework',
      tx,
    );
    const sourceRows = await tx
      .select({
        id: wmsTables.dispatchAttemptSources.id,
        stockEventId: wmsTables.dispatchAttemptSources.stockEventId,
      })
      .from(wmsTables.dispatchAttemptSources)
      .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, input.dispatchAttemptId))
      .orderBy(wmsTables.dispatchAttemptSources.id);
    if (sourceRows.length === 0 || sourceRows.some((source) => !source.stockEventId)) {
      throw new BadRequestException('Dispatch attempt does not own a complete set of stock source events');
    }

    const occurredAt = input.occurredAt ?? new Date();
    const sources: ShipmentDispatchEventReversal[] = [];
    for (const source of sourceRows) {
      sources.push(
        await this.eventStore.reverseShipmentDispatchEvent(
          {
            dispatchAttemptId: input.dispatchAttemptId,
            dispatchAttemptSourceId: source.id,
            originalShipEventId: source.stockEventId!,
            reversalJournalId: input.reversalJournalId,
            recallOperationId: input.recallOperationId,
            toLocationId: reworkLocation.id,
            occurredAt,
            reason: input.reason.trim(),
          },
          tx,
        ),
      );
    }
    return {
      reversalJournalId: input.reversalJournalId,
      sources,
      affectedSkuIds: [...new Set(sources.map((source) => source.skuId))].sort(),
    };
  }

  async transferShip(
    input: {
      skuId: string;
      fromWarehouseId: string;
      fromLocationId: string;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      await acquireStockAvailabilityLock(trx, input.skuId, input.fromWarehouseId);
      await assertReservationInvariant(trx, input.skuId, input.fromWarehouseId, input.quantity);
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          fromWarehouseId: input.fromWarehouseId,
          fromLocationId: input.fromLocationId,
          fromState: 'ON_HAND',
          toWarehouseId: input.fromWarehouseId,
          toLocationId: input.fromLocationId,
          toState: 'IN_TRANSFER',
          transitionType: 'MOVE',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );
      return { eventId: event?.id ?? null };
    };
    return this.dbService.run(exec, tx);
  }

  async transferReceive(
    input: {
      skuId: string;
      fromWarehouseId: string;
      fromLocationId: string;
      toWarehouseId: string;
      toLocationId: string;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          fromWarehouseId: input.fromWarehouseId,
          fromLocationId: input.fromLocationId,
          fromState: 'IN_TRANSFER',
          toWarehouseId: input.toWarehouseId,
          toLocationId: input.toLocationId,
          toState: 'ON_HAND',
          transitionType: 'MOVE',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );
      return { eventId: event?.id ?? null };
    };
    return this.dbService.run(exec, tx);
  }

  async adjustUp(
    input: {
      skuId: string;
      warehouseId: string;
      locationId?: string | null;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      // 0. 조기 멱등 흡수 — SKU/위치 조회보다 먼저. adjustUp 에는 락이 없으므로
      //    exec 진입 직후에 검사한다.
      if (input.idempotencyKey) {
        const existingId = await this.findEventIdByIdempotencyKey(trx, input.idempotencyKey);
        if (existingId) return { eventId: existingId };
      }

      // 1. SKU 정보 조회 (이름 가져오기)
      const sku = await trx.query.skus.findFirst({
        where: (s, { eq }) => eq(s.id, input.skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${input.skuId}`);
      }

      // 2. 위치 미지정 시 시스템 입고기본존으로 — 빈 문자열 uuid 비교(DB 에러)와
      //    locationId 없는 ledger 갱신 불가 문제를 막는다
      let effectiveLocationId = input.locationId ?? null;
      if (!effectiveLocationId) {
        await this.locationService.ensureSystemLocations(input.warehouseId, trx);
        const zone = await this.locationService.getSystemLocationByRole(input.warehouseId, 'inbound_default', trx);
        if (!zone) throw new BadRequestException('조정 기본 위치가 존재하지 않습니다.');
        effectiveLocationId = zone.id;
      }

      // 3. 현재 재고 조회
      const currentStock = await trx.query.stockLedgers.findFirst({
        where: (l, { eq, and }) =>
          and(
            eq(l.skuId, input.skuId),
            eq(l.warehouseId, input.warehouseId),
            eq(l.locationId, effectiveLocationId),
            eq(l.stockState, 'ON_HAND'),
          ),
      });

      const currentQuantity = currentStock?.qty ?? 0;
      const afterQuantity = currentQuantity + input.quantity;

      // 4. Stock Event 생성
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          toWarehouseId: input.warehouseId,
          toLocationId: effectiveLocationId,
          toState: 'ON_HAND',
          transitionType: 'ADJUST_UP',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );

      if (!event) {
        throw new BadRequestException('Failed to create stock event');
      }

      // 4. Outbox 적재 없음 — 같은 이유다 (위 `ship()` 주석 참조).

      this.logger.log(`ADJUST_UP: sku=${sku.name} qty=${input.quantity} (${currentQuantity} → ${afterQuantity})`);

      return { eventId: event?.id ?? null };
    };
    return this.dbService.run(exec, tx);
  }

  async adjustDown(
    input: {
      skuId: string;
      warehouseId: string;
      locationId?: string | null;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
      bypassReservationGuard?: boolean; // 실사·파손 등 물리적 사실만 true
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      // 0. (sku,warehouse) 직렬화 — bypass 여도 락은 획득
      await acquireStockAvailabilityLock(trx, input.skuId, input.warehouseId);

      // 0.5 조기 멱등 흡수 — 락 획득 *이후*에 검사한다. 락은 동시 재시도를
      //     완전히 직렬화하므로, 두 번째 호출이 락을 얻었을 때는 첫 번째 호출이
      //     이미 커밋(또는 롤백)한 뒤다. 락 이전에 검사했다면 두 트랜잭션 모두
      //     "아직 없음"을 보고 통과해버려 동시 재시도가 부족검증(§3)에서
      //     경합할 수 있었다 — 이 순서가 그 경합을 막는다.
      if (input.idempotencyKey) {
        const existingId = await this.findEventIdByIdempotencyKey(trx, input.idempotencyKey);
        if (existingId) return { eventId: existingId };
      }

      // 1. SKU 정보 조회
      const sku = await trx.query.skus.findFirst({
        where: (s, { eq }) => eq(s.id, input.skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${input.skuId}`);
      }

      // 2. 위치 미지정 시 ON_HAND가 가장 많은 위치에서 차감
      let effectiveLocationId = input.locationId ?? null;
      if (!effectiveLocationId) {
        const candidates = await trx
          .select({ locationId: wmsTables.stockLedgers.locationId, qty: wmsTables.stockLedgers.qty })
          .from(wmsTables.stockLedgers)
          .where(
            and(
              eq(wmsTables.stockLedgers.skuId, input.skuId),
              eq(wmsTables.stockLedgers.warehouseId, input.warehouseId),
              eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
              gt(wmsTables.stockLedgers.qty, 0),
            ),
          )
          .orderBy(asc(wmsTables.stockLedgers.locationId));
        let candidate: { locationId: string; generallyAvailableQty: number } | null = null;
        for (const row of candidates) {
          const availability = await this.batchControlledStock.getAvailability(
            {
              skuId: input.skuId,
              warehouseId: input.warehouseId,
              sourceLocationId: row.locationId,
            },
            trx,
            { lock: true },
          );
          if (
            availability.generallyAvailableQty >= input.quantity &&
            (!candidate || availability.generallyAvailableQty > candidate.generallyAvailableQty)
          ) {
            candidate = { locationId: row.locationId, generallyAvailableQty: availability.generallyAvailableQty };
          }
        }
        if (!candidate) {
          throw new BadRequestException('차감할 ON_HAND 재고가 없습니다.');
        }
        effectiveLocationId = candidate.locationId;
      }

      // 3. 현재 재고 조회 + 부족 검증 (ledger 음수 제약으로 500 나기 전에 400으로)
      const currentStock = await trx.query.stockLedgers.findFirst({
        where: (l, { eq, and }) =>
          and(
            eq(l.skuId, input.skuId),
            eq(l.warehouseId, input.warehouseId),
            eq(l.locationId, effectiveLocationId),
            eq(l.stockState, 'ON_HAND'),
          ),
      });

      const currentQuantity = currentStock?.qty ?? 0;
      if (currentQuantity < input.quantity) {
        throw new BadRequestException(
          `재고가 부족합니다. 해당 위치 ON_HAND ${currentQuantity} < 차감 요청 ${input.quantity}`,
        );
      }
      const afterQuantity = currentQuantity - input.quantity;

      // 3.5. 예약 불변식 가드 (물리적 사실이면 건너뜀)
      if (!input.bypassReservationGuard) {
        await assertReservationInvariant(trx, input.skuId, input.warehouseId, input.quantity);
      }

      // 4. Stock Event 생성
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          fromWarehouseId: input.warehouseId,
          fromLocationId: effectiveLocationId,
          fromState: 'ON_HAND',
          transitionType: 'ADJUST_DOWN',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );

      if (!event) {
        throw new BadRequestException('Failed to create stock event');
      }

      // 4. Outbox 적재 없음 — 같은 이유다 (위 `ship()` 주석 참조).

      this.logger.log(`ADJUST_DOWN: sku=${sku.name} qty=${input.quantity} (${currentQuantity} → ${afterQuantity})`);

      return { eventId: event?.id ?? null };
    };
    return this.dbService.run(exec, tx);
  }

  async moveInternal(
    input: {
      skuId: string;
      warehouseId: string;
      fromLocationId: string;
      toLocationId: string;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
      journalId?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent(
        {
          journalId: input.journalId,
          skuId: input.skuId,
          fromWarehouseId: input.warehouseId,
          fromLocationId: input.fromLocationId,
          toWarehouseId: input.warehouseId,
          toLocationId: input.toLocationId,
          fromState: 'ON_HAND',
          toState: 'ON_HAND',
          transitionType: 'MOVE',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );
      return { eventId: event?.id ?? null };
    };
    return this.dbService.run(exec, tx);
  }
}
