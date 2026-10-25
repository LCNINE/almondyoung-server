import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';

export type SupplierQueueStage = 'pending' | 'forwarded';

export type SupplierQueueSummary = {
  supplierId: string;
  supplierCode: string | null;
  supplierName: string;
  pendingShipments: number;
  forwardedShipments: number;
  /** 열린 입점사 상자(draft·recovery_required)에서 입점사가 «못 보냄»으로 알린 라인 수 */
  unfulfillableLines: number;
};

export type SupplierQueueLine = {
  shipmentLineId: string;
  skuId: string;
  skuName: string;
  /** 그 입점사와의 `sku_suppliers.supplier_sku` */
  supplierSku: string | null;
  qty: number;
  unfulfillableReason: string | null;
  unfulfillableReportedAt: Date | null;
};

export type SupplierQueueShipment = {
  shipmentId: string;
  stage: SupplierQueueStage;
  salesOrderId: string;
  orderNo: string;
  openedAt: Date;
  handoffId: string | null;
  handoffAt: Date | null;
  lines: SupplierQueueLine[];
};

/**
 * 직배 목록 — 입점사별 대기·넘긴 상자 읽기 (K3 PR4, N9). 고객 개인정보는 담지 않는다(수령인은 PR 5 의 내려받기에만).
 *
 * 단계 술어는 `shipment/supplier-shipment-stage.ts`(N6)와 같다 — 술어를 바꾸면 그 파일과 함께 바꾼다:
 *   열린 상자 = status IN (draft, recovery_required),
 *   pending = `supplier_handoff_id IS NULL`, forwarded = `supplier_handoff_id IS NOT NULL`.
 * 상자 조회는 `idx_shipments_supplier_status`(supplier_id, status) 를 탄다. 발송·취소·교체된 상자는 이 읽기에 없다.
 */
@Injectable()
export class SupplierShipmentQueueReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async summaryBySupplier(tx?: DbTx): Promise<SupplierQueueSummary[]> {
    return this.dbService.run(async (trx) => {
      const { shipments, shipmentLines, suppliers } = wmsTables;
      // 단계별 수는 필터 집계로 한 번에 센다(상자 수는 라인 조인에 부풀지 않게 distinct)
      const result = await trx
        .select({
          supplierId: suppliers.id,
          supplierCode: suppliers.code,
          supplierName: suppliers.name,
          pendingShipments:
            sql<number>`count(DISTINCT ${shipments.id}) FILTER (WHERE ${shipments.supplierHandoffId} IS NULL)`.mapWith(
              Number,
            ),
          forwardedShipments:
            sql<number>`count(DISTINCT ${shipments.id}) FILTER (WHERE ${shipments.supplierHandoffId} IS NOT NULL)`.mapWith(
              Number,
            ),
          unfulfillableLines: count(shipmentLines.id).mapWith(Number),
        })
        .from(shipments)
        .innerJoin(suppliers, eq(suppliers.id, shipments.supplierId))
        .leftJoin(
          shipmentLines,
          and(eq(shipmentLines.shipmentId, shipments.id), isNotNull(shipmentLines.unfulfillableReportedAt)),
        )
        .where(and(isNotNull(shipments.supplierId), inArray(shipments.status, ['draft', 'recovery_required'])))
        .groupBy(suppliers.id, suppliers.code, suppliers.name)
        .orderBy(asc(suppliers.name), asc(suppliers.id));
      return result;
    }, tx);
  }

  async openShipments(supplierId: string, stage: SupplierQueueStage, tx?: DbTx): Promise<SupplierQueueShipment[]> {
    return this.dbService.run(async (trx) => {
      const { shipments, shipmentLines, supplierHandoffs, fulfillmentOrderItems, salesOrders, skus, skuSuppliers } =
        wmsTables;
      const boxes = await trx
        .select({
          shipmentId: shipments.id,
          openedAt: shipments.openedAt,
          handoffId: shipments.supplierHandoffId,
          handoffAt: supplierHandoffs.createdAt,
        })
        .from(shipments)
        .leftJoin(supplierHandoffs, eq(supplierHandoffs.id, shipments.supplierHandoffId))
        .where(
          and(
            eq(shipments.supplierId, supplierId),
            inArray(shipments.status, ['draft', 'recovery_required']),
            stage === 'pending' ? isNull(shipments.supplierHandoffId) : isNotNull(shipments.supplierHandoffId),
          ),
        )
        .orderBy(asc(shipments.openedAt), asc(shipments.id));
      if (boxes.length === 0) return [];

      const lineRows = await trx
        .select({
          shipmentId: shipmentLines.shipmentId,
          shipmentLineId: shipmentLines.id,
          skuId: shipmentLines.skuId,
          skuName: skus.name,
          supplierSku: skuSuppliers.supplierSku,
          qty: shipmentLines.qty,
          unfulfillableReason: shipmentLines.unfulfillableReason,
          unfulfillableReportedAt: shipmentLines.unfulfillableReportedAt,
          salesOrderId: salesOrders.id,
          orderNo: sql<string>`COALESCE(${salesOrders.displayOrderNo}, ${salesOrders.channelOrderId})`,
        })
        .from(shipmentLines)
        .innerJoin(skus, eq(skus.id, shipmentLines.skuId))
        .innerJoin(fulfillmentOrderItems, eq(fulfillmentOrderItems.id, shipmentLines.fulfillmentOrderItemId))
        // FOI.sales_order_id 는 varchar 지만 FO 생성이 판매주문 uuid 만 넣는다 — uuid 로 맞춰 PK 를 탄다
        .innerJoin(salesOrders, sql`${salesOrders.id} = ${fulfillmentOrderItems.salesOrderId}::uuid`)
        .leftJoin(
          skuSuppliers,
          and(eq(skuSuppliers.skuId, shipmentLines.skuId), eq(skuSuppliers.supplierId, supplierId)),
        )
        .where(
          inArray(
            shipmentLines.shipmentId,
            boxes.map((b) => b.shipmentId),
          ),
        )
        .orderBy(asc(shipmentLines.createdAt), asc(shipmentLines.id));

      const byBox = new Map<string, typeof lineRows>();
      for (const l of lineRows) byBox.set(l.shipmentId, [...(byBox.get(l.shipmentId) ?? []), l]);

      return boxes.flatMap((b): SupplierQueueShipment[] => {
        const lines = byBox.get(b.shipmentId) ?? [];
        // 라인 없는 상자는 FO 생성이 만들지 않는다 — 주문을 못 정하니 목록에 낼 수 없다
        if (lines.length === 0) return [];
        return [
          {
            shipmentId: b.shipmentId,
            stage,
            salesOrderId: lines[0].salesOrderId,
            orderNo: lines[0].orderNo,
            openedAt: b.openedAt,
            handoffId: b.handoffId,
            handoffAt: b.handoffAt,
            lines: lines.map((l) => ({
              shipmentLineId: l.shipmentLineId,
              skuId: l.skuId,
              skuName: l.skuName,
              supplierSku: l.supplierSku,
              qty: l.qty,
              unfulfillableReason: l.unfulfillableReason,
              unfulfillableReportedAt: l.unfulfillableReportedAt,
            })),
          },
        ];
      });
    }, tx);
  }
}
