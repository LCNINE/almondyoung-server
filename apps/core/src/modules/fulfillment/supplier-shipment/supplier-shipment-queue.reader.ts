import { Injectable } from '@nestjs/common';
import { AnyColumn, and, asc, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
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

/** 주문번호 — 표시용 번호가 없으면 채널 주문번호. 직배 목록과 시트(행 검증 포함)가 같은 식을 쓴다. */
export function orderNoSql() {
  return sql<string>`COALESCE(${wmsTables.salesOrders.displayOrderNo}, ${wmsTables.salesOrders.channelOrderId})`;
}

/**
 * 상자가 판매주문에 닿는 라인을 하나라도 가졌다 — 상자는 라인으로만 주문에 이어진다.
 * 요약과 목록이 같은 술어를 써서 수가 목록과 어긋나지 않는다.
 */
export function hasOrderLine(shipmentId: AnyColumn) {
  // 바깥 쿼리가 같은 테이블을 조인하므로 별칭을 쓴다(안 쓰면 바깥 이름이 안쪽을 가린다)
  return sql`EXISTS (
    SELECT 1 FROM shipment_lines hol_l
      JOIN fulfillment_order_items hol_i ON hol_i.id = hol_l.fulfillment_order_item_id
      JOIN fulfillment_orders hol_o ON hol_o.id = hol_i.fulfillment_order_id AND hol_o.sales_order_id IS NOT NULL
      WHERE hol_l.shipment_id = ${shipmentId}
  )`;
}

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
      return trx
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
        .where(
          and(
            isNotNull(shipments.supplierId),
            inArray(shipments.status, ['draft', 'recovery_required']),
            hasOrderLine(shipments.id),
          ),
        )
        .groupBy(suppliers.id, suppliers.code, suppliers.name)
        .orderBy(asc(suppliers.name), asc(suppliers.id));
    }, tx);
  }

  async openShipments(supplierId: string, stage: SupplierQueueStage, tx?: DbTx): Promise<SupplierQueueShipment[]> {
    return this.dbService.run(async (trx) => {
      const {
        shipments,
        shipmentLines,
        supplierHandoffs,
        fulfillmentOrderItems,
        fulfillmentOrders,
        salesOrders,
        skus,
        skuSuppliers,
      } = wmsTables;
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
            hasOrderLine(shipments.id),
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
          orderNo: orderNoSql(),
        })
        .from(shipmentLines)
        .innerJoin(skus, eq(skus.id, shipmentLines.skuId))
        .innerJoin(fulfillmentOrderItems, eq(fulfillmentOrderItems.id, shipmentLines.fulfillmentOrderItemId))
        // 판매주문은 FO 로 잇는다(FOI.sales_order_id 는 형 없는 varchar). 직배 FO 는 항상 판매주문이 있어 inner join
        .innerJoin(fulfillmentOrders, eq(fulfillmentOrders.id, fulfillmentOrderItems.fulfillmentOrderId))
        .innerJoin(salesOrders, eq(salesOrders.id, fulfillmentOrders.salesOrderId))
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
        // 라인 없는 상자는 쿼리에서 이미 빠진다(hasOrderLine) — 방어적으로만 둔다
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
