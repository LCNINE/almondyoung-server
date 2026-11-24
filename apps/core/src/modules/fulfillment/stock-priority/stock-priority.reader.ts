import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { and, eq, gt, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { DbTx, StockAllocation, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { readWarehouseAvailability } from '../../inventory/shared/availability/warehouse-availability';
import {
  StockPriorityBlock,
  StockPriorityLineDto,
  StockPriorityPlanDto,
  StockPriorityPreviewDto,
} from '../dto/stock-priority.dto';
import { uniqueInOrder } from '../services/consolidation-shipment-reads';
import { canonicalFulfillmentRequestHash } from '../services/fulfillment-command.service';
import { reservationQueueKeySql } from '../services/reservation-queue-key';
import { loadSellmateShipmentIds } from '../services/sellmate-handed-over-shipments';
import { selectConfirmedReservationQtyByLine } from '../services/shipment-aggregate';
import { loadPriorityOutstanding } from '../services/shipment-reservation.service';
import { planStockPriority, PriorityPlan, PrioritySourceLine, PriorityTargetLine } from './stock-priority.plan';

export interface StockPriorityFacts {
  shipmentId: string;
  warehouseId: string | null;
  fulfillmentOrderIds: string[];
  stockAllocation: StockAllocation;
  orderNos: string[];
  blocked: StockPriorityBlock | null;
  lines: (StockPriorityLineDto & { lineId: string })[];
  targets: PriorityTargetLine[];
  sources: PrioritySourceLine[];
  base: PriorityPlan;
  /** 나갈 수 있던 상자까지 쓰는 계획 — 그래야 다 채워질 때만 있다 */
  withReady: PriorityPlan | null;
}

@Injectable()
export class StockPriorityReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  preview(shipmentId: string, tx?: DbTx): Promise<StockPriorityPreviewDto> {
    return this.dbService.run(async (trx) => {
      const facts = await this.load(shipmentId, trx);
      const boxes = await this.sourceBoxes(facts, trx);
      const describe = (plan: PriorityPlan | null): StockPriorityPlanDto | null =>
        plan === null
          ? null
          : {
              freeQty: plan.free.reduce((total, row) => total + row.qty, 0),
              takes: plan.takes.map((take) => ({
                shipmentId: take.sourceShipmentId,
                orderNos: boxes.orderNos.get(take.sourceShipmentId) ?? [],
                skuName: facts.lines.find((line) => line.skuId === take.skuId)?.skuName ?? '',
                qty: take.qty,
                ready: take.ready,
                emptied:
                  plan.takes
                    .filter((row) => row.sourceShipmentId === take.sourceShipmentId)
                    .reduce((total, row) => total + row.qty, 0) === boxes.reserved.get(take.sourceShipmentId),
              })),
              missingQty: plan.missingQty,
              token: stockPriorityToken(facts, plan),
            };
      return {
        shipmentId,
        orderNos: facts.orderNos,
        stockAllocation: facts.stockAllocation,
        blocked: facts.blocked,
        lines: facts.lines.map(({ skuId, skuName, qty, reservedQty, missingQty }) => ({
          skuId,
          skuName,
          qty,
          reservedQty,
          missingQty,
        })),
        plan: facts.blocked ? null : describe(facts.base),
        planWithReady: facts.blocked ? null : describe(facts.withReady),
      };
    }, tx);
  }

  async load(shipmentId: string, trx: DbTx): Promise<StockPriorityFacts> {
    const [shipment] = await trx
      .select({
        status: wmsTables.shipments.status,
        warehouseId: wmsTables.shipments.warehouseId,
        supplierId: wmsTables.shipments.supplierId,
        recoveryCode: wmsTables.shipments.recoveryCode,
      })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundError(`Shipment not found: ${shipmentId}`);

    const rows = await this.linesOf([shipmentId], trx);
    const confirmed = await selectConfirmedReservationQtyByLine(
      trx,
      rows.map((row) => row.lineId),
    );
    const lines = rows.map((row) => {
      const reservedQty = Math.min(row.qty, confirmed.get(row.lineId) ?? 0);
      return {
        lineId: row.lineId,
        skuId: row.skuId,
        skuName: row.skuName,
        qty: row.qty,
        reservedQty,
        missingQty: row.qty - reservedQty,
      };
    });
    const targets = lines
      .filter((line) => line.missingQty > 0)
      .map((line) => ({ lineId: line.lineId, skuId: line.skuId, missingQty: line.missingQty }));
    const fulfillmentOrderIds = uniqueInOrder(rows.map((row) => row.fulfillmentOrderId));
    const facts: StockPriorityFacts = {
      shipmentId,
      warehouseId: shipment.warehouseId,
      fulfillmentOrderIds,
      // 합포장 상자는 담긴 주문이 모두 우선할당일 때만 우선할당이다
      stockAllocation: rows.every((row) => row.stockAllocation === 'priority') ? 'priority' : 'normal',
      orderNos: uniqueInOrder(rows.flatMap((row) => row.orderNo ?? [])),
      blocked: null,
      lines,
      targets,
      sources: [],
      base: { free: [], takes: [], missingQty: 0 },
      withReady: null,
    };
    facts.blocked = await this.blockOf(shipmentId, shipment, targets.length, trx);
    if (facts.blocked || !shipment.warehouseId) return facts;

    const skuIds = [...new Set(targets.map((line) => line.skuId))].sort();
    const free = new Map<string, number>();
    for (const skuId of skuIds) {
      const { available } = await readWarehouseAvailability(trx, skuId, shipment.warehouseId);
      const ahead = await loadPriorityOutstanding(trx, skuId, shipment.warehouseId, fulfillmentOrderIds);
      free.set(skuId, Math.max(0, available - ahead));
    }
    facts.sources = await this.sourceLines(shipmentId, shipment.warehouseId, skuIds, fulfillmentOrderIds, trx);
    facts.base = planStockPriority(targets, free, facts.sources, false);
    if (facts.base.missingQty > 0) {
      const withReady = planStockPriority(targets, free, facts.sources, true);
      facts.withReady = withReady.missingQty === 0 ? withReady : null;
    }
    return facts;
  }

  private async blockOf(
    shipmentId: string,
    shipment: { status: string; warehouseId: string | null; supplierId: string | null; recoveryCode: string | null },
    missingLines: number,
    trx: DbTx,
  ): Promise<StockPriorityBlock | null> {
    if (shipment.supplierId || !shipment.warehouseId) return 'SUPPLIER_BOX';
    if (shipment.status !== 'draft') return 'NOT_DRAFT';
    if (shipment.recoveryCode) return 'IN_RECOVERY';
    if ((await loadSellmateShipmentIds(trx, [shipmentId])).has(shipmentId)) return 'SELLMATE_BOX';
    if ((await this.inBatch([shipmentId], trx)).has(shipmentId)) return 'IN_BATCH';
    if (missingLines === 0) return 'NOTHING_MISSING';
    return null;
  }

  /** 재고를 내줄 수 있는 줄 — 같은 창고의 다른 draft 상자가 그 상품에 잡은 예약 */
  private async sourceLines(
    shipmentId: string,
    warehouseId: string,
    skuIds: string[],
    fulfillmentOrderIds: string[],
    trx: DbTx,
  ): Promise<PrioritySourceLine[]> {
    const holders = await trx
      .selectDistinct({ shipmentId: wmsTables.shipmentLines.shipmentId })
      .from(wmsTables.stockReservations)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.stockReservations.shipmentLineId))
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .where(
        and(
          inArray(wmsTables.stockReservations.skuId, skuIds),
          eq(wmsTables.stockReservations.warehouseId, warehouseId),
          eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
          eq(wmsTables.stockReservations.status, 'confirmed'),
          gt(wmsTables.stockReservations.quantity, 0),
          eq(wmsTables.shipments.status, 'draft'),
          eq(wmsTables.shipments.warehouseId, warehouseId),
          isNull(wmsTables.shipments.supplierId),
          isNull(wmsTables.shipments.recoveryCode),
          ne(wmsTables.shipments.id, shipmentId),
        ),
      );
    const boxIds = holders.map((row) => row.shipmentId);
    if (boxIds.length === 0) return [];

    const rows = await this.linesOf(boxIds, trx);
    const own = new Set(fulfillmentOrderIds);
    const kept = new Set(boxIds);
    for (const row of rows) {
      if (row.stockAllocation === 'priority' || own.has(row.fulfillmentOrderId)) kept.delete(row.shipmentId);
    }
    for (const id of await loadSellmateShipmentIds(trx, [...kept])) kept.delete(id);
    for (const id of await this.inBatch([...kept], trx)) kept.delete(id);

    const lines = rows.filter((row) => kept.has(row.shipmentId));
    const confirmed = await selectConfirmedReservationQtyByLine(
      trx,
      lines.map((row) => row.lineId),
    );
    const short = new Set(
      lines.filter((row) => (confirmed.get(row.lineId) ?? 0) < row.qty).map((row) => row.shipmentId),
    );
    return lines.flatMap((row) => {
      const reservedQty = confirmed.get(row.lineId) ?? 0;
      if (reservedQty === 0 || !skuIds.includes(row.skuId)) return [];
      return [
        {
          lineId: row.lineId,
          shipmentId: row.shipmentId,
          skuId: row.skuId,
          reservedQty,
          ready: !short.has(row.shipmentId),
          queuedAt: new Date(row.queueKey).getTime(),
        },
      ];
    });
  }

  private linesOf(shipmentIds: string[], trx: DbTx) {
    return trx
      .select({
        lineId: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        skuId: wmsTables.shipmentLines.skuId,
        skuName: wmsTables.skus.name,
        qty: wmsTables.shipmentLines.qty,
        fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
        stockAllocation: wmsTables.fulfillmentOrders.stockAllocation,
        orderNo: sql<
          string | null
        >`COALESCE(${wmsTables.salesOrders.displayOrderNo}, ${wmsTables.salesOrders.channelOrderId})`,
        queueKey: sql<Date | string>`${reservationQueueKeySql(sql`shipment_lines`)}`,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
      .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
      .orderBy(wmsTables.shipmentLines.id);
  }

  private async inBatch(shipmentIds: string[], trx: DbTx): Promise<Set<string>> {
    if (shipmentIds.length === 0) return new Set();
    const rows = await trx
      .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds),
          notInArray(wmsTables.outboundBatchWorkItems.status, ['excluded', 'completed']),
        ),
      );
    return new Set(rows.map((row) => row.shipmentId));
  }

  private async sourceBoxes(facts: StockPriorityFacts, trx: DbTx) {
    const ids = [
      ...new Set([...facts.base.takes, ...(facts.withReady?.takes ?? [])].map((take) => take.sourceShipmentId)),
    ];
    const rows = ids.length === 0 ? [] : await this.linesOf(ids, trx);
    const confirmed = await selectConfirmedReservationQtyByLine(
      trx,
      rows.map((row) => row.lineId),
    );
    const orderNos = new Map<string, string[]>();
    const reserved = new Map<string, number>();
    for (const row of rows) {
      orderNos.set(
        row.shipmentId,
        uniqueInOrder([...(orderNos.get(row.shipmentId) ?? []), ...(row.orderNo ? [row.orderNo] : [])]),
      );
      reserved.set(row.shipmentId, (reserved.get(row.shipmentId) ?? 0) + (confirmed.get(row.lineId) ?? 0));
    }
    return { orderNos, reserved };
  }
}

/** 계획이 그대로인지 확인하는 값. 화면이 본 것과 다른 주문의 재고를 옮기지 않게 한다. */
export function stockPriorityToken(
  facts: Pick<StockPriorityFacts, 'shipmentId' | 'targets'>,
  plan: PriorityPlan,
): string {
  return canonicalFulfillmentRequestHash({ shipmentId: facts.shipmentId, targets: facts.targets, plan });
}
