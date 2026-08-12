import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { acquireStockAvailabilityLocks } from '../../shared/locks/stock-availability-lock';

export interface CreateTransferOrderInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  eta?: Date;
  memo?: string;
  actorId?: string;
  lines: Array<{ skuId: string; fromLocationId: string; quantity: number }>;
}

export interface ReceiveTransferInput {
  transferOrderId: string;
  idempotencyKey: string;
  toLocationId: string;
  actorId?: string;
  lines: Array<{ transferOrderLineId: string; receivedQty: number; lostQty: number }>;
}

/**
 * 이동 지시서의 검증·비즈니스 로직·DB 쓰기가 전부 여기 산다. 중국↔부천처럼 출발과
 * 도착이 수 주 떨어진 구간에서는 그 짝을 소유하는 문서가 없으면 "떠났는데 안 도착한"
 * 물량이 유실된다 — 이 매니저가 그 문서다.
 */
@Injectable()
export class WarehouseTransferManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commandService: InventoryCommandService,
    private readonly locationService: LocationService,
    private readonly idempotency: InventoryIdempotencyService,
  ) {}

  async createOrder(input: CreateTransferOrderInput, tx?: DbTx): Promise<{ transferOrderId: string }> {
    return this.dbService.run(async (trx) => {
      if (input.lines.length === 0) throw new BadRequestError('At least one line is required');
      if (input.fromWarehouseId === input.toWarehouseId) {
        throw new BadRequestError('창고 간 이동만 지시서로 만든다 — 창고 내 이동은 movement job 을 쓴다');
      }
      // 같은 (skuId, fromLocationId) 가 두 번 들어오면 uq_transfer_order_lines_sku 가
      // DrizzleQueryError 로 새어 입력 오류가 500 이 된다. receive 가 같은 종류의 중복을
      // 앞단에서 400 으로 잡으므로(아래 seenLineIds) 생성도 같은 규칙을 쓴다 — 한 파일
      // 안에서 두 규칙이 갈리는 게 더 나쁘다.
      const seenLineKeys = new Set<string>();
      for (const line of input.lines) {
        if (line.quantity <= 0) throw new BadRequestError('quantity must be positive');
        const key = `${line.skuId}:${line.fromLocationId}`;
        if (seenLineKeys.has(key)) {
          throw new BadRequestError(`Duplicate transfer line (skuId, fromLocationId): ${key}`);
        }
        seenLineKeys.add(key);
      }

      const [order] = await trx
        .insert(wmsTables.transferOrders)
        .values({
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          eta: input.eta ?? null,
          etaUpdatedAt: input.eta ? new Date() : null,
          memo: input.memo ?? null,
          actorId: input.actorId ?? null,
        })
        .returning({ id: wmsTables.transferOrders.id });
      if (!order) throw new Error('transfer_orders insert returned no row');

      await trx.insert(wmsTables.transferOrderLines).values(
        input.lines.map((line) => ({
          transferOrderId: order.id,
          skuId: line.skuId,
          fromLocationId: line.fromLocationId,
          plannedQty: line.quantity,
        })),
      );

      return { transferOrderId: order.id };
    }, tx);
  }

  async ship(
    input: { transferOrderId: string; idempotencyKey: string; actorId?: string },
    tx?: DbTx,
  ): Promise<{ shippedLines: number }> {
    return this.idempotency.withIdempotency(
      'transfer.ship',
      input.idempotencyKey,
      input,
      async (trx) => {
        const order = await this.lockOrder(trx, input.transferOrderId);
        if (order.status !== 'draft') {
          throw new ConflictError(`Transfer order ${order.id} is already ${order.status}`);
        }

        // id 정렬 — 락 획득 순서를 결정적으로 만든다. 정렬 없는 조회는 계획에 따라
        // 순서가 바뀌어 라인 집합이 겹치는 두 지시서 사이에 교차 데드락을 낸다.
        const lines = await trx
          .select()
          .from(wmsTables.transferOrderLines)
          .where(eq(wmsTables.transferOrderLines.transferOrderId, order.id))
          .orderBy(asc(wmsTables.transferOrderLines.id));

        // 루프 안에서 라인마다 잡지 말고 여기서 한 번에 — 정렬·중복제거된 순서로
        // 획득해야 교차 데드락이 안 난다. 루프 안 transferShip 의 단건 락은
        // advisory xact 락이 재진입 가능하므로 no-op 이 된다.
        await acquireStockAvailabilityLocks(
          trx,
          lines.map((line) => ({ skuId: line.skuId, warehouseId: order.fromWarehouseId })),
        );

        const [journal] = await trx
          .insert(wmsTables.stockJournals)
          .values({ sourceType: 'warehouse_transfer', sourceId: order.id, actorId: input.actorId ?? null })
          .returning({ id: wmsTables.stockJournals.id });

        for (const line of lines) {
          await this.commandService.transferShip(
            {
              skuId: line.skuId,
              fromWarehouseId: order.fromWarehouseId,
              fromLocationId: line.fromLocationId,
              quantity: line.plannedQty,
              idempotencyKey: `transfer.ship:${order.id}:${line.id}`,
              reason: `Transfer to warehouse ${order.toWarehouseId}`,
            },
            trx,
          );
          await trx
            .update(wmsTables.transferOrderLines)
            .set({ shippedQty: line.plannedQty, updatedAt: new Date() })
            .where(eq(wmsTables.transferOrderLines.id, line.id));
        }

        await trx
          .update(wmsTables.transferOrders)
          .set({ status: 'shipped', shippedAt: new Date(), journalId: journal?.id ?? null, updatedAt: new Date() })
          .where(eq(wmsTables.transferOrders.id, order.id));

        return { shippedLines: lines.length };
      },
      tx,
    );
  }

  async receive(input: ReceiveTransferInput, tx?: DbTx): Promise<{ receiptId: string }> {
    if (input.lines.length === 0) throw new BadRequestError('At least one receipt line is required');
    // 같은 라인이 한 회차에 두 번 들어오면 재고가 조용히 유실된다. 두 번째 항목의
    // 원장 멱등키(`transfer.receive:{receiptId}:{lineId}`)가 첫 번째와 같아
    // createEvent 가 onConflictDoNothing 으로 흡수해버리는데, 문서 수량은 두 번
    // 더해져 outstanding 이 0 이 되고 지시서가 closed 로 마감된다. 그러면 남은
    // 물량이 운송중존에 영구 방치되고 findOutstanding 에도 안 잡힌다.
    // 순수 입력 검증이라 멱등키를 선점하기 전에 본다.
    const seenLineIds = new Set<string>();
    for (const item of input.lines) {
      if (seenLineIds.has(item.transferOrderLineId)) {
        throw new BadRequestError(`Duplicate transfer order line in receipt: ${item.transferOrderLineId}`);
      }
      seenLineIds.add(item.transferOrderLineId);
    }

    return this.idempotency.withIdempotency(
      'transfer.receive',
      input.idempotencyKey,
      input,
      async (trx) => {
        const order = await this.lockOrder(trx, input.transferOrderId);
        if (order.status !== 'shipped' && order.status !== 'partially_received') {
          throw new ConflictError(`Transfer order ${order.id} is ${order.status}; cannot receive`);
        }

        const linesById = await this.lockLines(trx, order.id, [...seenLineIds]);

        // 출발·도착 양쪽을 루프 전에 한 번에 잠근다 — 정렬·중복제거된 순서라야
        // 라인 집합이 겹치는 동시 도착 처리끼리 교차 데드락이 안 난다.
        await acquireStockAvailabilityLocks(trx, [
          ...[...linesById.values()].map((line) => ({ skuId: line.skuId, warehouseId: order.fromWarehouseId })),
          ...[...linesById.values()].map((line) => ({ skuId: line.skuId, warehouseId: order.toWarehouseId })),
        ]);

        // 떠난 재고는 출발 창고의 운송중존에 park 돼 있다 — 출발 선반이 아니다.
        await this.locationService.ensureSystemLocations(order.fromWarehouseId, trx);
        const transitZone = await this.locationService.getSystemLocationByRole(
          order.fromWarehouseId,
          'transit_out',
          trx,
        );

        const [journal] = await trx
          .insert(wmsTables.stockJournals)
          .values({ sourceType: 'warehouse_transfer_receive', sourceId: order.id, actorId: input.actorId ?? null })
          .returning({ id: wmsTables.stockJournals.id });

        const [receipt] = await trx
          .insert(wmsTables.transferOrderReceipts)
          .values({ transferOrderId: order.id, journalId: journal?.id ?? null, actorId: input.actorId ?? null })
          .returning({ id: wmsTables.transferOrderReceipts.id });
        if (!receipt) throw new Error('transfer_order_receipts insert returned no row');

        for (const item of input.lines) {
          if (item.receivedQty < 0 || item.lostQty < 0) throw new BadRequestError('quantities must not be negative');
          if (item.receivedQty + item.lostQty <= 0) throw new BadRequestError('receipt line must move some quantity');

          const line = linesById.get(item.transferOrderLineId);
          if (!line) throw new NotFoundError(`Transfer order line not found: ${item.transferOrderLineId}`);
          const outstanding = line.shippedQty - line.receivedQty - line.lostQty;
          if (item.receivedQty + item.lostQty > outstanding) {
            throw new ConflictError(
              `Receipt exceeds outstanding quantity (outstanding=${outstanding}) for line ${line.id}`,
            );
          }

          let receiveEventId: string | null = null;
          if (item.receivedQty > 0) {
            const result = await this.commandService.transferReceive(
              {
                skuId: line.skuId,
                fromWarehouseId: order.fromWarehouseId,
                fromLocationId: transitZone.id,
                toWarehouseId: order.toWarehouseId,
                toLocationId: input.toLocationId,
                quantity: item.receivedQty,
                idempotencyKey: `transfer.receive:${receipt.id}:${line.id}`,
                reason: `Transfer from warehouse ${order.fromWarehouseId}`,
              },
              trx,
            );
            receiveEventId = result.eventId;
          }

          let lostEventId: string | null = null;
          if (item.lostQty > 0) {
            // 운송 중 분실은 IN_TRANSFER 를 소진시키는 SCRAP 이다. 새 transition_type 을
            // 만들지 않는 이유는 이벤트 계약에 노출될 경우 소비자 선배포가 필요하기 때문이다.
            const result = await this.commandService.scrapInTransit(
              {
                skuId: line.skuId,
                warehouseId: order.fromWarehouseId,
                locationId: transitZone.id,
                quantity: item.lostQty,
                idempotencyKey: `transfer.lost:${receipt.id}:${line.id}`,
                reason: 'Lost in transit',
              },
              trx,
            );
            lostEventId = result.eventId;
          }

          await trx.insert(wmsTables.transferOrderReceiptLines).values({
            receiptId: receipt.id,
            transferOrderLineId: line.id,
            toLocationId: input.toLocationId,
            receivedQty: item.receivedQty,
            lostQty: item.lostQty,
            receiveEventId,
            lostEventId,
          });

          await trx
            .update(wmsTables.transferOrderLines)
            .set({
              receivedQty: line.receivedQty + item.receivedQty,
              lostQty: line.lostQty + item.lostQty,
              version: line.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.transferOrderLines.id, line.id));
        }

        await this.refreshOrderStatus(trx, order.id);
        return { receiptId: receipt.id };
      },
      tx,
    );
  }

  async updateEta(input: { transferOrderId: string; eta: Date }, tx?: DbTx): Promise<void> {
    await this.dbService.run(async (trx) => {
      const order = await this.lockOrder(trx, input.transferOrderId);
      await trx
        .update(wmsTables.transferOrders)
        .set({ eta: input.eta, etaUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(wmsTables.transferOrders.id, order.id));
    }, tx);
  }

  private async lockOrder(trx: DbTx, transferOrderId: string) {
    const [order] = await trx
      .select()
      .from(wmsTables.transferOrders)
      .where(eq(wmsTables.transferOrders.id, transferOrderId))
      .for('update')
      .limit(1);
    if (!order) throw new NotFoundError(`Transfer order not found: ${transferOrderId}`);
    return order;
  }

  /**
   * 회차가 건드릴 라인을 한 번에 잠근다. id 정렬이 락 획득 순서를 결정적으로 만들어
   * 교차 데드락을 막는다. 지시서에 속하지 않는 id 는 여기서 404 로 걸린다.
   */
  private async lockLines(trx: DbTx, transferOrderId: string, lineIds: string[]) {
    const lines = await trx
      .select()
      .from(wmsTables.transferOrderLines)
      .where(
        and(
          eq(wmsTables.transferOrderLines.transferOrderId, transferOrderId),
          inArray(wmsTables.transferOrderLines.id, lineIds),
        ),
      )
      .orderBy(asc(wmsTables.transferOrderLines.id))
      .for('update');

    const byId = new Map(lines.map((line) => [line.id, line]));
    for (const lineId of lineIds) {
      if (!byId.has(lineId)) throw new NotFoundError(`Transfer order line not found: ${lineId}`);
    }
    return byId;
  }

  /** 미도착 잔량이 0 이면 closed, 일부라도 받았으면 partially_received. */
  private async refreshOrderStatus(trx: DbTx, transferOrderId: string): Promise<void> {
    const t = wmsTables.transferOrderLines;
    const [row] = await trx
      .select({
        outstanding: sql<number>`COALESCE(SUM(${t.shippedQty} - ${t.receivedQty} - ${t.lostQty}), 0)::int`,
        settled: sql<number>`COALESCE(SUM(${t.receivedQty} + ${t.lostQty}), 0)::int`,
      })
      .from(t)
      .where(eq(t.transferOrderId, transferOrderId));

    const outstanding = Number(row?.outstanding ?? 0);
    const settled = Number(row?.settled ?? 0);
    const status = outstanding === 0 ? 'closed' : settled > 0 ? 'partially_received' : 'shipped';

    await trx
      .update(wmsTables.transferOrders)
      .set({ status, closedAt: status === 'closed' ? new Date() : null, updatedAt: new Date() })
      .where(eq(wmsTables.transferOrders.id, transferOrderId));
  }
}
