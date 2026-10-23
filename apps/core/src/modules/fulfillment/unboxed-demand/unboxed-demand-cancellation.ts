import { Injectable } from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { projectFulfillmentOrderProgress } from '../services/fulfillment-progress.service';
import type {
  CanceledFulfillmentOrder,
  ReducedDemandItem,
  UnboxedDemandItem,
  UnboxedDemandReduction,
} from './unboxed-demand.types';

/** 상자 전 수요를 줄일 수 있는 FO 상태. fulfillment_status enum 에서 들어올 수 있는 값은 이 둘뿐이다(N12). */
export const CANCELLABLE_FULFILLMENT_STATUSES: ReadonlySet<string> = new Set(['created', 'ready']);

type FoiRow = typeof wmsTables.fulfillmentOrderItems.$inferSelect;
type FoRow = typeof wmsTables.fulfillmentOrders.$inferSelect;

/**
 * 판매주문 취소의 상자 전 쓰기 — FO·FOI 를 건드리는 유일한 길(K7 PR3).
 * 수요 감소는 `qty` 를 깎지 않고 `canceledQty` 를 올린다(상자 후 취소와 같은 표현). FO 상태는 투영이 정한다.
 * 호출 순서는 판매주문 잠금 → `lockForCancellation` → `reduce`/`cancelOrder` 이고 모두 같은 tx 다.
 */
@Injectable()
export class UnboxedDemandCancellation {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /**
   * 판매주문의 FO → FOI(id 순)를 FOR UPDATE 로 잠그고 읽는다. FO 가 없으면 [].
   * 상자 전 FO 는 예약을 갖지 않는다 — 확정 예약을 만나면 불변식 위반이라 던진다(N13, fail-closed).
   */
  async lockForCancellation(salesOrderId: string, tx: DbTx): Promise<UnboxedDemandItem[]> {
    return this.dbService.run(async (trx) => {
      const fos = await this.lockFulfillmentOrders(salesOrderId, trx);
      if (fos.length === 0) return [];
      const foIds = fos.map((fo) => fo.id);
      const items = await trx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(inArray(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foIds))
        .orderBy(wmsTables.fulfillmentOrderItems.id)
        .for('update');
      await this.assertNoConfirmedReservations(foIds, items, trx);

      const statusByFo = new Map(fos.map((fo) => [fo.id, fo.status]));
      return items.map((item) => this.toDemandItem(item, statusByFo.get(item.fulfillmentOrderId) ?? ''));
    }, tx);
  }

  /**
   * 부분 취소. 줄마다 canceledQty += qty, 전량이면 FOI 'canceled', 손댄 FO 는 투영으로 상태를 다시 쓴다.
   * 호출자가 같은 tx 에서 `lockForCancellation` 을 먼저 불렀다고 전제한다(잠금·예약 확인은 거기서 끝났다).
   * 최신 행을 다시 읽어 cancellableQty 를 넘는 감소만 막는다 — 판매주문이 이미 판정한 값이라 500 이 맞다.
   */
  async reduce(salesOrderId: string, reductions: UnboxedDemandReduction[], tx: DbTx): Promise<ReducedDemandItem[]> {
    if (reductions.length === 0) return [];
    return this.dbService.run(async (trx) => {
      const qtyByItem = new Map<string, number>();
      for (const r of reductions) {
        qtyByItem.set(r.fulfillmentOrderItemId, (qtyByItem.get(r.fulfillmentOrderItemId) ?? 0) + r.qty);
      }
      const { items, statusByFo } = await this.readOrder(salesOrderId, trx);
      const itemById = new Map(items.map((item) => [item.id, item]));

      const reduced: ReducedDemandItem[] = [];
      for (const [itemId, qty] of qtyByItem) {
        const item = itemById.get(itemId);
        if (!item) throw new Error(`FOI ${itemId} does not belong to sales order ${salesOrderId}`);
        const cancellable = this.toDemandItem(item, statusByFo.get(item.fulfillmentOrderId) ?? '').cancellableQty;
        if (qty > cancellable) {
          throw new Error(`FOI ${itemId} reduction ${qty} exceeds cancellable ${cancellable}`);
        }
        const newCanceledQty = item.canceledQty + qty;
        const newStatus = newCanceledQty === item.qty ? 'canceled' : item.status;
        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ canceledQty: newCanceledQty, status: newStatus, updatedAt: new Date() })
          .where(eq(wmsTables.fulfillmentOrderItems.id, itemId));
        reduced.push({
          fulfillmentOrderItemId: itemId,
          fulfillmentOrderId: item.fulfillmentOrderId,
          skuId: item.skuId,
          qty,
          previousCanceledQty: item.canceledQty,
          newCanceledQty,
          previousStatus: item.status,
          newStatus,
        });
      }

      for (const foId of new Set(reduced.map((r) => r.fulfillmentOrderId))) {
        await this.projectFulfillmentOrder(foId, trx);
      }
      return reduced;
    }, tx);
  }

  /**
   * 전체 취소. created·ready FO 마다 FOI canceledQty = qty − shippedQty → FO 투영.
   * 호출자가 같은 tx 에서 `lockForCancellation` 을 먼저 불렀다고 전제한다.
   */
  async cancelOrder(salesOrderId: string, tx: DbTx): Promise<CanceledFulfillmentOrder[]> {
    return this.dbService.run(async (trx) => {
      const { items, fos } = await this.readOrder(salesOrderId, trx);
      const canceled: CanceledFulfillmentOrder[] = [];
      for (const fo of fos) {
        if (!CANCELLABLE_FULFILLMENT_STATUSES.has(fo.status)) continue;
        for (const item of items.filter((i) => i.fulfillmentOrderId === fo.id)) {
          const canceledQty = item.qty - item.shippedQty;
          if (canceledQty === item.canceledQty) continue;
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({ canceledQty, status: canceledQty === item.qty ? 'canceled' : item.status, updatedAt: new Date() })
            .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
        }
        await this.projectFulfillmentOrder(fo.id, trx);
        canceled.push({ fulfillmentOrderId: fo.id, previousStatus: fo.status });
      }
      return canceled;
    }, tx);
  }

  private async lockFulfillmentOrders(salesOrderId: string, trx: DbTx): Promise<FoRow[]> {
    return trx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
      .orderBy(wmsTables.fulfillmentOrders.id)
      .for('update');
  }

  private async readOrder(
    salesOrderId: string,
    trx: DbTx,
  ): Promise<{ fos: FoRow[]; items: FoiRow[]; statusByFo: Map<string, string> }> {
    const fos = await trx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
      .orderBy(wmsTables.fulfillmentOrders.id);
    const items =
      fos.length === 0
        ? []
        : await trx
            .select()
            .from(wmsTables.fulfillmentOrderItems)
            .where(
              inArray(
                wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
                fos.map((fo) => fo.id),
              ),
            )
            .orderBy(wmsTables.fulfillmentOrderItems.id);
    return { fos, items, statusByFo: new Map(fos.map((fo) => [fo.id, fo.status])) };
  }

  private toDemandItem(item: FoiRow, foStatus: string): UnboxedDemandItem {
    const cancellableQty = CANCELLABLE_FULFILLMENT_STATUSES.has(foStatus)
      ? Math.max(0, item.qty - item.canceledQty - Math.max(item.pickedQty, item.shippedQty))
      : 0;
    return {
      fulfillmentOrderItemId: item.id,
      fulfillmentOrderId: item.fulfillmentOrderId,
      fulfillmentOrderStatus: foStatus,
      salesOrderLineId: item.salesOrderLineId,
      skuId: item.skuId,
      qty: item.qty,
      canceledQty: item.canceledQty,
      shippedQty: item.shippedQty,
      pickedQty: item.pickedQty,
      reservedQty: item.reservedQty,
      cancellableQty,
    };
  }

  private async assertNoConfirmedReservations(foIds: string[], items: FoiRow[], trx: DbTx): Promise<void> {
    const [found] = await trx
      .select({
        id: wmsTables.stockReservations.id,
        targetType: wmsTables.stockReservations.targetType,
        targetId: wmsTables.stockReservations.targetId,
        fulfillmentOrderItemId: wmsTables.stockReservations.fulfillmentOrderItemId,
      })
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.status, 'confirmed'),
          or(
            inArray(
              wmsTables.stockReservations.fulfillmentOrderItemId,
              items.map((item) => item.id),
            ),
            and(
              eq(wmsTables.stockReservations.targetType, 'FULFILLMENT_ORDER'),
              inArray(wmsTables.stockReservations.targetId, foIds),
            ),
          ),
        ),
      )
      .limit(1);
    if (found) {
      // FOI id 로 걸린 행은 target 이 FO 가 아닐 수 있다 — 점검을 돌린 FO 를 FOI 에서 거꾸로 찾아 적는다.
      const foId =
        found.targetType === 'FULFILLMENT_ORDER'
          ? found.targetId
          : (items.find((item) => item.id === found.fulfillmentOrderItemId)?.fulfillmentOrderId ?? found.targetId);
      throw new Error(
        `Unboxed fulfillment order ${foId} has confirmed reservations — unboxed demand carries no reservation (reservation ${found.id})`,
      );
    }
  }

  /** FOI 수량으로 FO 상태를 다시 쓴다. totalQty·totalReservedQty 는 건드리지 않는다(상자 후 취소와 같다). */
  private async projectFulfillmentOrder(foId: string, trx: DbTx): Promise<void> {
    const items = await trx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foId));
    const [fo] = await trx.select().from(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, foId));
    if (!fo) return;
    // 항목이 없으면 투영할 수요가 없다 — 취소 대상이었던 FO 라 canceled 로 닫는다.
    const status =
      items.length === 0
        ? 'canceled'
        : projectFulfillmentOrderProgress(
            items.map((item) => ({
              id: item.id,
              qty: item.qty,
              shippedQty: item.shippedQty,
              canceledQty: item.canceledQty,
              confirmedReservedQty: 0,
              activeLineQty: 0,
              processing: item.pickedQty > 0,
              recoveryRequired: false,
            })),
          ).status;
    const now = new Date();
    await trx
      .update(wmsTables.fulfillmentOrders)
      .set({
        status,
        canceledAt: status === 'canceled' ? (fo.canceledAt ?? now) : fo.canceledAt,
        updatedAt: now,
      })
      .where(eq(wmsTables.fulfillmentOrders.id, foId));
  }
}
