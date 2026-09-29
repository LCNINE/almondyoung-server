import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, notInArray, sql } from 'drizzle-orm';
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
    const [item] = await trx
      .select({ id: WI.id, batchStartedAt: inventoryTables.outboundBatches.startedAt })
      .from(WI)
      .innerJoin(inventoryTables.outboundBatches, eq(inventoryTables.outboundBatches.id, WI.batchId))
      .where(and(eq(WI.shipmentId, shipmentId), notInArray(WI.status, ['completed', 'excluded'])))
      .limit(1);
    if (!item) return { workItemId: null, batchStarted: false, lines, rows: [] };
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
    return { workItemId: item.id, batchStarted: item.batchStartedAt !== null, lines, rows };
  }
}
