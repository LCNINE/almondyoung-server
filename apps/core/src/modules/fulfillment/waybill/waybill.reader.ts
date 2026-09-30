import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, notInArray, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { DbTx, inventorySchema, inventoryTables } from '../../inventory/schema/inventory.schema';
import { canonicalFulfillmentRequestHash } from '../services/fulfillment-command.service';
import { WAYBILL, WAYBILL_TERMINAL_STATUSES } from './waybill.constants';
import type { IssueContext, LabelAllocation, WaybillRow } from './waybill.types';

const W = inventoryTables.waybills;

@Injectable()
export class WaybillReader {
  constructor(@InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>) {}

  recipientHashOf(recipientSnapshot: unknown): string {
    return canonicalFulfillmentRequestHash(recipientSnapshot);
  }

  async loadIssueContext(trx: DbTx, shipmentId: string): Promise<IssueContext> {
    const [shipment] = await trx
      .select()
      .from(inventoryTables.shipments)
      .where(eq(inventoryTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundError(`${WAYBILL.ERROR.SHIPMENT_NOT_FOUND}: ${shipmentId}`);
    const rows = await trx
      .select({
        skuId: inventoryTables.shipmentLines.skuId,
        skuName: inventoryTables.skus.name,
        productName: inventoryTables.salesOrderLines.productName,
        quantity: inventoryTables.shipmentLines.qty,
      })
      .from(inventoryTables.shipmentLines)
      .innerJoin(
        inventoryTables.fulfillmentOrderItems,
        eq(inventoryTables.fulfillmentOrderItems.id, inventoryTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        inventoryTables.fulfillmentOrders,
        eq(inventoryTables.fulfillmentOrders.id, inventoryTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .innerJoin(inventoryTables.skus, eq(inventoryTables.skus.id, inventoryTables.shipmentLines.skuId))
      .leftJoin(
        inventoryTables.salesOrders,
        eq(inventoryTables.salesOrders.id, inventoryTables.fulfillmentOrders.salesOrderId),
      )
      .leftJoin(
        inventoryTables.salesOrderLines,
        sql`${inventoryTables.salesOrderLines.id}::text = ${inventoryTables.fulfillmentOrderItems.salesOrderLineId}`,
      )
      .where(eq(inventoryTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(inventoryTables.shipmentLines.id));
    if (!rows.length) throw new NotFoundError(`${WAYBILL.ERROR.SHIPMENT_NOT_FOUND}: ${shipmentId} has no lines`);
    return {
      shipmentId: shipment.id,
      status: shipment.status,
      manifestVersion: shipment.manifestVersion,
      recipientSnapshot: shipment.recipientSnapshot,
      lines: rows.map((r) => ({
        productName: r.productName ?? r.skuName ?? '',
        skuName: r.skuName ?? '',
        quantity: r.quantity,
        skuId: r.skuId,
      })),
      entrancePassword: shipment.entrancePassword,
    };
  }

  async getActiveWaybill(trx: DbTx, shipmentId: string): Promise<WaybillRow | undefined> {
    const [wb] = await trx
      .select()
      .from(W)
      .where(and(eq(W.shipmentId, shipmentId), notInArray(W.status, [...WAYBILL_TERMINAL_STATUSES])))
      .limit(1);
    return wb;
  }

  /**
   * 송장 품목 줄의 원천 — 박스의 활성 작업 항목에 매단 배정(수량 > 0)을 로케이션 코드·SKU 이름과 함께 읽는다.
   * 활성 작업 항목이 없으면 출고 완료(`completed`)된 마지막 작업 항목을 쓴다 — 출고된 박스의 송장 재출력(#913 동작,
   * 원장 Ruling F3). 배정 행은 지우거나 고치지 않으므로 출고 뒤에도 출력 때와 같은 내용·지문이 나온다. `excluded` 는
   * 박스가 그 배치에서 빠졌다는 뜻이라 어느 경우에도 쓰지 않는다. 활성 항목이 있으면 늘 그것이 먼저다 — 게이트와
   * 송장 스캔 상태가 보는 활성 박스의 동작은 이 대체와 무관하다.
   * 잠그지 않는다: 렌더·상태 조회는 읽기이고, 출력 확인·게이트는 호출자가 작업 항목 잠금을 이미 쥐고 있다.
   */
  async loadLabelAllocation(trx: DbTx, shipmentId: string): Promise<LabelAllocation> {
    const WI = inventoryTables.outboundBatchWorkItems;
    const A = inventoryTables.pickingSourceAllocations;
    const lines = await trx
      .select({ id: inventoryTables.shipmentLines.id, qty: inventoryTables.shipmentLines.qty })
      .from(inventoryTables.shipmentLines)
      .where(eq(inventoryTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(inventoryTables.shipmentLines.id));
    const [active] = await trx
      .select({ id: WI.id, status: WI.status, batchStartedAt: inventoryTables.outboundBatches.startedAt })
      .from(WI)
      .innerJoin(inventoryTables.outboundBatches, eq(inventoryTables.outboundBatches.id, WI.batchId))
      .where(and(eq(WI.shipmentId, shipmentId), notInArray(WI.status, ['completed', 'excluded'])))
      // 활성 행은 최대 하나다 — uq_outbound_work_item_active_shipment 가 보장한다.
      .limit(1);
    const item =
      active ??
      (
        await trx
          .select({ id: WI.id, batchStartedAt: inventoryTables.outboundBatches.startedAt })
          .from(WI)
          .innerJoin(inventoryTables.outboundBatches, eq(inventoryTables.outboundBatches.id, WI.batchId))
          .where(and(eq(WI.shipmentId, shipmentId), eq(WI.status, 'completed')))
          .orderBy(sql`${WI.completedAt} DESC NULLS LAST`, desc(WI.id))
          .limit(1)
      )[0];
    if (!item) return { workItemId: null, batchStarted: false, withdrawing: false, lines, rows: [] };
    const rows = await trx
      .select({
        shipmentLineId: A.shipmentLineId,
        locationCode: inventoryTables.locations.code,
        skuId: inventoryTables.shipmentLines.skuId,
        skuName: inventoryTables.skus.name,
        qty: A.qty,
      })
      .from(A)
      .innerJoin(inventoryTables.locations, eq(inventoryTables.locations.id, A.sourceLocationId))
      .innerJoin(inventoryTables.shipmentLines, eq(inventoryTables.shipmentLines.id, A.shipmentLineId))
      .innerJoin(inventoryTables.skus, eq(inventoryTables.skus.id, inventoryTables.shipmentLines.skuId))
      .where(and(eq(A.workItemId, item.id), gt(A.qty, 0)))
      .orderBy(asc(inventoryTables.locations.code), asc(inventoryTables.shipmentLines.skuId));
    return {
      workItemId: item.id,
      batchStarted: item.batchStartedAt !== null,
      withdrawing: active?.status === 'withdrawing',
      lines,
      rows,
    };
  }
}
