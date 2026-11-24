import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { readWarehouseAvailability } from '../../inventory/shared/availability/warehouse-availability';
import {
  InboundReservationRelease,
  ReservationHolder,
  ReservationReleasePreview,
  StockRemoval,
} from '../../inventory/inbound/kernel/inbound-reservation-release.port';
import { hasStockPrioritySql, reservationQueueKeySql } from '../services/reservation-queue-key';
import { loadSellmateShipmentIds } from '../services/sellmate-handed-over-shipments';
import { selectConfirmedReservationQtyByLine } from '../services/shipment-aggregate';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { planReservationRelease, ReleaseSourceLine, ReservationReleasePlan } from './reservation-release.plan';

interface HeldLine extends ReleaseSourceLine {
  fulfillmentOrderId: string;
  orderNo: string | null;
  releasable: boolean;
}

interface RemovalPlan {
  removal: StockRemoval;
  lines: HeldLine[];
  plan: ReservationReleasePlan;
}

@Injectable()
export class StockRemovalReservations extends InboundReservationRelease {
  constructor(private readonly reservations: ShipmentReservationService) {
    super();
  }

  async preview(removal: StockRemoval, tx: DbTx): Promise<ReservationReleasePreview> {
    const { lines, plan } = await this.planFor(removal, tx);
    const released = new Map(plan.releases.map((row) => [row.lineId, row.qty]));
    const touched = lines.filter((line) => released.has(line.lineId));
    return {
      orderCount: new Set(touched.map((line) => line.fulfillmentOrderId)).size,
      quantity: plan.releases.reduce((total, row) => total + row.qty, 0),
      missingQty: plan.missingQty,
      heldBy: plan.missingQty > 0 ? holdersOf(lines.filter((line) => !line.releasable)) : [],
    };
  }

  async release(removals: readonly StockRemoval[], reason: string, tx: DbTx): Promise<void> {
    const seen = await this.planAll(removals, tx);
    if (seen.length === 0) return;
    // 예약을 고치기 전에 관련 상자를 한 번에 잠그고(상자 → 재고 순), 잠근 뒤 다시 계산한다.
    const locked = seen.flatMap(({ plan }) => plan.releases.map((row) => row.lineId));
    await asPlainConflict(async () => {
      for (const warehouseId of new Set(seen.map(({ removal }) => removal.warehouseId))) {
        const here = seen.filter(({ removal }) => removal.warehouseId === warehouseId);
        const lineIds = here.flatMap(({ plan }) => plan.releases.map((row) => row.lineId));
        if (lineIds.length === 0) continue;
        await this.reservations.lockLinesForReservation(
          lineIds,
          here.map(({ removal }) => removal.skuId),
          warehouseId,
          tx,
        );
      }
      for (const { plan } of await this.planAll(removals, tx)) {
        for (const { lineId, qty } of plan.releases) {
          // 잠그는 사이 다른 줄이 예약을 잡았다 — 잠그지 않은 상자는 여기서 건드리지 않는다
          if (!locked.includes(lineId)) throw new ConflictException('예약이 방금 바뀌었습니다. 다시 시도해 주세요.');
          await this.reservations.releasePartial(lineId, qty, reason, tx);
        }
      }
    });
  }

  private async planAll(removals: readonly StockRemoval[], tx: DbTx): Promise<RemovalPlan[]> {
    const plans: RemovalPlan[] = [];
    for (const removal of mergeRemovals(removals)) {
      const planned = await this.planFor(removal, tx);
      if (planned.plan.missingQty > 0) {
        const holders = holdersOf(planned.lines.filter((line) => !line.releasable));
        const names = holders.map((row) => `${row.orderNo ?? '주문번호 없음'} ${row.quantity}개`).join(', ');
        throw new ConflictException(
          `출고 준비 중인 주문이 이 재고를 잡고 있습니다${names ? `: ${names}` : ''}. 송장을 무효화하고 출고 배치에서 뺀 뒤 다시 시도해 주세요.`,
        );
      }
      if (planned.plan.releases.length > 0) plans.push(planned);
    }
    return plans;
  }

  private async planFor(removal: StockRemoval, tx: DbTx): Promise<RemovalPlan> {
    const { onHand, reserved } = await readWarehouseAvailability(tx, removal.skuId, removal.warehouseId);
    // 원장이 이미 모자라면(입고 기록과 재고가 어긋남) 잡힌 예약까지만 본다 — 그 불일치는 커널이 거절한다
    const need = Math.min(reserved, reserved - (onHand - removal.quantity));
    if (need <= 0) return { removal, lines: [], plan: { releases: [], missingQty: 0 } };
    const lines = await this.heldLines(removal, tx);
    const releasable = lines.filter((line) => line.releasable);
    return { removal, lines, plan: planReservationRelease(need, releasable) };
  }

  /** 이 상품·창고에 예약을 쥔 상자 줄 전부. 준비 전(draft) 상자이고 배치·복구 중이 아니면 놓을 수 있다. */
  private async heldLines({ skuId, warehouseId }: StockRemoval, tx: DbTx): Promise<HeldLine[]> {
    const rows = await tx
      .select({
        lineId: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipments.id,
        status: wmsTables.shipments.status,
        recoveryCode: wmsTables.shipments.recoveryCode,
        reservedQty: sql<number>`SUM(${wmsTables.stockReservations.quantity})::int`,
        fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
        priority: hasStockPrioritySql(sql`fulfillment_orders`),
        orderNo: sql<
          string | null
        >`COALESCE(${wmsTables.salesOrders.displayOrderNo}, ${wmsTables.salesOrders.channelOrderId})`,
        queueKey: sql<Date | string>`${reservationQueueKeySql(sql`shipment_lines`)}`,
      })
      .from(wmsTables.stockReservations)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.stockReservations.shipmentLineId))
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
      .where(
        and(
          eq(wmsTables.stockReservations.skuId, skuId),
          eq(wmsTables.stockReservations.warehouseId, warehouseId),
          eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      )
      .groupBy(
        wmsTables.shipmentLines.id,
        wmsTables.shipments.id,
        wmsTables.fulfillmentOrders.id,
        wmsTables.salesOrders.id,
      );
    const shipmentIds = [...new Set(rows.map((row) => row.shipmentId))];
    const inBatch = await this.inBatch(shipmentIds, tx);
    const sellmate = await loadSellmateShipmentIds(tx, shipmentIds);
    const short = await this.shortBoxes(shipmentIds, tx);
    return rows.map((row) => ({
      lineId: row.lineId,
      reservedQty: row.reservedQty,
      lastResort: row.priority || sellmate.has(row.shipmentId),
      ready: !short.has(row.shipmentId),
      queuedAt: new Date(row.queueKey).getTime(),
      fulfillmentOrderId: row.fulfillmentOrderId,
      orderNo: row.orderNo,
      releasable: row.status === 'draft' && row.recoveryCode === null && !inBatch.has(row.shipmentId),
    }));
  }

  private async inBatch(shipmentIds: string[], tx: DbTx): Promise<Set<string>> {
    if (shipmentIds.length === 0) return new Set();
    const rows = await tx
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

  private async shortBoxes(shipmentIds: string[], tx: DbTx): Promise<Set<string>> {
    if (shipmentIds.length === 0) return new Set();
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        qty: wmsTables.shipmentLines.qty,
      })
      .from(wmsTables.shipmentLines)
      .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds));
    const confirmed = await selectConfirmedReservationQtyByLine(
      tx,
      lines.map((line) => line.id),
    );
    return new Set(lines.filter((line) => (confirmed.get(line.id) ?? 0) < line.qty).map((line) => line.shipmentId));
  }
}

function mergeRemovals(removals: readonly StockRemoval[]): StockRemoval[] {
  const merged = new Map<string, StockRemoval>();
  for (const removal of removals) {
    const key = `${removal.skuId}:${removal.warehouseId}`;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, quantity: current.quantity + removal.quantity } : removal);
  }
  return [...merged.values()].sort((a, b) => a.skuId.localeCompare(b.skuId));
}

function holdersOf(lines: readonly HeldLine[]): ReservationHolder[] {
  const byOrder = new Map<string, ReservationHolder>();
  for (const line of lines) {
    const current = byOrder.get(line.fulfillmentOrderId);
    byOrder.set(line.fulfillmentOrderId, {
      orderNo: line.orderNo,
      quantity: (current?.quantity ?? 0) + line.reservedQty,
    });
  }
  return [...byOrder.values()].sort((a, b) => (a.orderNo ?? '').localeCompare(b.orderNo ?? ''));
}

/** 출고 쪽 잠금·불변식 거절은 반영된 것이 없는 거절이다 — 현장 앱이 «결과 모름»으로 읽지 않게 코드를 뺀다. */
async function asPlainConflict(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof ConflictException) throw new ConflictException(error.message);
    throw error;
  }
}
