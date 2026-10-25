import { and, asc, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { lockShipmentConnectedComponentGraph } from '../services/shipment-reservation.service';
import type { CarrierCode } from '../waybill/carrier/carrier-gateway.interface';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { normalizeTrackingNo } from './supplier-dispatch';
import { supplierSheetPreviewToken } from './supplier-sheet-preview-token';
import {
  classifySupplierRows,
  rowKeyOf,
  type JudgeBox,
  type JudgeContext,
  type JudgeLine,
  type RowVerdict,
  type SupplierApplyPlan,
} from './supplier-sheet.judge-rules';
import type { ParsedSupplierRow } from './supplier-sheet.parser';
import { orderNoSql } from './supplier-shipment-queue.reader';

export type {
  RowVerdict,
  SupplierApplyPlan,
  SupplierRowErrorCode,
  SupplierRowVerdictKind,
} from './supplier-sheet.judge-rules';

export type SupplierSheetJudgement = { rows: RowVerdict[]; plan: SupplierApplyPlan; token: string };

/**
 * 올린 직배 시트의 줄을 판정한다(K3 PR5, N4) — 미리보기와 적용(Task 10)이 같은 함수를 쓰고, 아무것도 쓰지 않는다.
 * 판정 규칙은 `supplier-sheet.judge-rules.ts`(순수 함수), 이 파일은 그 규칙이 읽는 DB 사실을 모은다.
 *
 * `lock` 이면 공유 락 순서(FOI → 상자 → 라인)를 지킨다: 파일의 FOI 로 `lockShipmentConnectedComponentGraph` 를 먼저 잡고,
 * 그 FOI 의 살아 있는 상자를 id 순 `FOR UPDATE` 로 다시 읽는다. 송장번호가 겹치는 «묶음 밖» 상자는 읽기만 한다.
 */
export async function judgeSupplierSheet(
  tx: DbTx,
  supplierId: string,
  rows: readonly ParsedSupplierRow[],
  opts: { lock: boolean },
): Promise<SupplierSheetJudgement> {
  const keys = [...new Set(rows.map((row) => rowKeyOf(row.rowKey)).filter((key): key is string => key !== null))];
  let fois = await loadFois(tx, keys);
  if (opts.lock && fois.length > 0) {
    await lockShipmentConnectedComponentGraph(
      tx,
      fois.map((foi) => foi.id),
    );
    fois = await loadFois(tx, keys); // 락 뒤 수량(취소)을 다시 읽는다
  }
  const foiIds = fois.map((foi) => foi.id);

  const lineByFoi = await loadLiveSupplierLines(tx, supplierId, foiIds);
  const boxIds = [...new Set([...lineByFoi.values()].map((line) => line.shipmentId))].sort();
  const boxes = await loadBoxes(tx, boxIds, opts.lock);
  const shippedBoxIds = boxes.filter((box) => box.status !== 'draft').map((box) => box.id);
  const usedWaybills =
    shippedBoxIds.length === 0
      ? []
      : await tx
          .select({
            shipmentId: wmsTables.waybills.shipmentId,
            carrier: wmsTables.waybills.carrier,
            trackingNo: wmsTables.waybills.trackingNo,
          })
          .from(wmsTables.waybills)
          .where(and(inArray(wmsTables.waybills.shipmentId, shippedBoxIds), eq(wmsTables.waybills.status, 'used')));

  const numbers = [...new Set(rows.map((row) => normalizeTrackingNo(row.trackingNo)).filter(Boolean))];
  const liveWaybills =
    numbers.length === 0
      ? []
      : await tx
          .select({ shipmentId: wmsTables.waybills.shipmentId, trackingNo: wmsTables.waybills.trackingNo })
          .from(wmsTables.waybills)
          .where(
            and(
              inArray(wmsTables.waybills.trackingNo, numbers),
              notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
            ),
          );
  const liveTrackingBoxes = new Map<string, (string | null)[]>();
  for (const wb of liveWaybills) {
    if (wb.trackingNo === null) continue;
    liveTrackingBoxes.set(wb.trackingNo, [...(liveTrackingBoxes.get(wb.trackingNo) ?? []), wb.shipmentId]);
  }

  const usedWaybillByBox = new Map<string, { carrier: CarrierCode; trackingNo: string | null }>();
  for (const wb of usedWaybills) {
    if (wb.shipmentId !== null) usedWaybillByBox.set(wb.shipmentId, { carrier: wb.carrier, trackingNo: wb.trackingNo });
  }
  const ctx: JudgeContext = {
    supplierId,
    fois: new Map(fois.map((foi) => [foi.id, foi])),
    lineByFoi,
    boxes: new Map(boxes.map((box) => [box.id, box])),
    usedWaybillByBox,
    liveTrackingBoxes,
  };
  const judged = classifySupplierRows(rows, ctx);
  const manifestVersions = new Map(boxes.map((box) => [box.id, box.manifestVersion]));
  return { ...judged, token: supplierSheetPreviewToken(judged.rows, manifestVersions) };
}

async function loadFois(tx: DbTx, keys: readonly string[]) {
  if (keys.length === 0) return [];
  const { fulfillmentOrderItems } = wmsTables;
  return tx
    .select({
      id: fulfillmentOrderItems.id,
      qty: fulfillmentOrderItems.qty,
      shippedQty: fulfillmentOrderItems.shippedQty,
      canceledQty: fulfillmentOrderItems.canceledQty,
    })
    .from(fulfillmentOrderItems)
    .where(inArray(fulfillmentOrderItems.id, [...keys]));
}

/**
 * FOI 마다 살아 있는 입점사 라인(canceled·superseded 가 아닌 입점사 상자의 라인) — N3 로 하나다, 둘 이상이면 프로그래밍 오류.
 * 주문번호·공급사 상품코드는 시트를 만든 식(`orderNoSql`, 올린 입점사와의 `sku_suppliers`) 그대로 읽어 줄과 비교한다.
 */
async function loadLiveSupplierLines(
  tx: DbTx,
  supplierId: string,
  foiIds: readonly string[],
): Promise<Map<string, JudgeLine>> {
  if (foiIds.length === 0) return new Map();
  const { shipments, shipmentLines, fulfillmentOrderItems, fulfillmentOrders, salesOrders, skuSuppliers } = wmsTables;
  const lines = await tx
    .select({
      foiId: shipmentLines.fulfillmentOrderItemId,
      lineId: shipmentLines.id,
      shipmentId: shipmentLines.shipmentId,
      qty: shipmentLines.qty,
      unfulfillableReason: shipmentLines.unfulfillableReason,
      supplierSku: skuSuppliers.supplierSku,
      orderNo: orderNoSql(),
    })
    .from(shipmentLines)
    .innerJoin(
      shipments,
      and(
        eq(shipments.id, shipmentLines.shipmentId),
        isNotNull(shipments.supplierId),
        notInArray(shipments.status, ['canceled', 'superseded']),
      ),
    )
    .innerJoin(fulfillmentOrderItems, eq(fulfillmentOrderItems.id, shipmentLines.fulfillmentOrderItemId))
    // 직배 목록·시트와 같이 FO 로 판매주문을 잇는다(직배 FO 는 항상 판매주문이 있다)
    .innerJoin(fulfillmentOrders, eq(fulfillmentOrders.id, fulfillmentOrderItems.fulfillmentOrderId))
    .innerJoin(salesOrders, eq(salesOrders.id, fulfillmentOrders.salesOrderId))
    .leftJoin(skuSuppliers, and(eq(skuSuppliers.skuId, shipmentLines.skuId), eq(skuSuppliers.supplierId, supplierId)))
    .where(inArray(shipmentLines.fulfillmentOrderItemId, [...foiIds]));
  const byFoi = new Map<string, JudgeLine>();
  for (const { foiId, ...line } of lines) {
    if (byFoi.has(foiId)) throw new Error(`FOI ${foiId} has more than one live supplier shipment line`);
    byFoi.set(foiId, line);
  }
  return byFoi;
}

async function loadBoxes(
  tx: DbTx,
  boxIds: readonly string[],
  lock: boolean,
): Promise<(JudgeBox & { manifestVersion: number })[]> {
  if (boxIds.length === 0) return [];
  const { shipments } = wmsTables;
  const query = tx
    .select({
      id: shipments.id,
      status: shipments.status,
      supplierId: shipments.supplierId,
      supplierHandoffId: shipments.supplierHandoffId,
      recoveryCode: shipments.recoveryCode,
      recipientSnapshot: shipments.recipientSnapshot,
      manifestVersion: shipments.manifestVersion,
    })
    .from(shipments)
    .where(inArray(shipments.id, [...boxIds]))
    .orderBy(asc(shipments.id));
  const boxes = lock ? await query.for('update') : await query;
  if (boxes.length !== boxIds.length) {
    throw new Error(`Supplier sheet judge: loaded ${boxes.length} of ${boxIds.length} shipments`);
  }
  return boxes;
}
