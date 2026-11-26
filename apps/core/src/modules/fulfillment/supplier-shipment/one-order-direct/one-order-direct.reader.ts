import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import type {
  DirectDeliveryAwaitingDto,
  DirectDeliveryBlockerDto,
  DirectDeliveryPreviewDto,
  DirectDeliveryRecipientDto,
} from '../../dto/one-order-direct.dto';
import { ACTIVE_WORK_ITEM_STATUSES } from '../../services/work-item-status';
import { WAYBILL_TERMINAL_STATUSES } from '../../waybill/waybill.constants';
import { parseRecipient } from '../../waybill/waybill-request.assembler';
import { orderNoSql } from '../supplier-shipment-queue.reader';

type BoxRow = typeof wmsTables.shipments.$inferSelect;

/** 받는 분 칸 — 공급처에 그대로 불러 줄 모양. 불완전하면 null. */
export function recipientOf(snapshot: unknown, entrancePassword: string | null): DirectDeliveryRecipientDto | null {
  try {
    const r = parseRecipient(snapshot);
    const street = [r.roadAddress, r.detailAddress].filter(Boolean).join(' ');
    return {
      name: r.recipientName,
      phone: r.phone,
      address: r.postalCode ? `(${r.postalCode}) ${street}` : street,
      memo: r.deliveryNote ?? '',
      entrancePassword: entrancePassword ?? '',
    };
  } catch (e) {
    if (e instanceof BadRequestError) return null;
    throw e;
  }
}

/** 맡기기·되돌리기·미리 보기가 함께 쓰는 사실. 잠그지 않는다 — 명령은 잠근 뒤 다시 읽는다. */
export type DirectDeliveryFacts = {
  box: BoxRow;
  lines: Array<{
    lineId: string;
    fulfillmentOrderItemId: string;
    fulfillmentOrderId: string;
    skuId: string;
    skuName: string;
    stockType: string;
    qty: number;
    reservedQty: number;
    createdAt: Date;
    demandRequestedAt: Date | null;
    linkedSupplierId: string | null;
  }>;
  salesOrderIds: string[];
  orderNo: string | null;
  /** 줄이 닿는 출고주문의 창고(하나가 아니면 null) */
  foWarehouseId: string | null;
  activeWaybill: boolean;
  activeWork: { batchId: string; batchNo: string } | null;
  sellmateHandedOver: boolean;
  recipient: DirectDeliveryRecipientDto | null;
};

export async function loadDirectDeliveryFacts(tx: DbTx, shipmentId: string): Promise<DirectDeliveryFacts> {
  const { shipments, shipmentLines, skus, skuSuppliers, fulfillmentOrderItems, fulfillmentOrders, salesOrders } =
    wmsTables;
  const [box] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).limit(1);
  if (!box) throw new NotFoundError(`Shipment ${shipmentId} not found`);
  const lines = await tx
    .select({
      lineId: shipmentLines.id,
      fulfillmentOrderItemId: shipmentLines.fulfillmentOrderItemId,
      fulfillmentOrderId: fulfillmentOrderItems.fulfillmentOrderId,
      skuId: shipmentLines.skuId,
      skuName: skus.name,
      stockType: skus.stockType,
      qty: shipmentLines.qty,
      reservedQty: shipmentLines.reservedQty,
      createdAt: shipmentLines.createdAt,
      demandRequestedAt: shipmentLines.demandRequestedAt,
      linkedSupplierId: skuSuppliers.supplierId,
      salesOrderId: fulfillmentOrders.salesOrderId,
      foWarehouseId: fulfillmentOrders.warehouseId,
      orderNo: orderNoSql(),
    })
    .from(shipmentLines)
    .innerJoin(skus, eq(skus.id, shipmentLines.skuId))
    .innerJoin(fulfillmentOrderItems, eq(fulfillmentOrderItems.id, shipmentLines.fulfillmentOrderItemId))
    .innerJoin(fulfillmentOrders, eq(fulfillmentOrders.id, fulfillmentOrderItems.fulfillmentOrderId))
    .leftJoin(salesOrders, eq(salesOrders.id, fulfillmentOrders.salesOrderId))
    // 상품마다 공급처 연결은 많아야 하나다(현재 데이터) — 둘 이상이면 줄이 늘어 아래에서 가려낸다
    .leftJoin(skuSuppliers, eq(skuSuppliers.skuId, shipmentLines.skuId))
    .where(eq(shipmentLines.shipmentId, shipmentId))
    .orderBy(asc(shipmentLines.id), asc(skuSuppliers.supplierId));
  if (lines.length === 0) throw new NotFoundError(`Shipment ${shipmentId} has no lines`);

  const byLine = new Map<string, (typeof lines)[number] & { links: Set<string> }>();
  for (const row of lines) {
    const seen = byLine.get(row.lineId);
    if (seen) {
      if (row.linkedSupplierId) seen.links.add(row.linkedSupplierId);
      continue;
    }
    byLine.set(row.lineId, { ...row, links: new Set(row.linkedSupplierId ? [row.linkedSupplierId] : []) });
  }
  const unique = [...byLine.values()];
  const salesOrderIds = [...new Set(unique.map((l) => l.salesOrderId).filter((id): id is string => id !== null))];
  const foWarehouses = new Set(unique.map((l) => l.foWarehouseId));

  const [waybill] = await tx
    .select({ id: wmsTables.waybills.id })
    .from(wmsTables.waybills)
    .where(
      and(
        eq(wmsTables.waybills.shipmentId, shipmentId),
        notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
      ),
    )
    .limit(1);
  const [work] = await tx
    .select({ batchId: wmsTables.outboundBatches.id, batchNo: wmsTables.outboundBatches.batchNumber })
    .from(wmsTables.outboundBatchWorkItems)
    .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, wmsTables.outboundBatchWorkItems.batchId))
    .where(
      and(
        eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
        inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
      ),
    )
    .limit(1);
  const handedOver =
    salesOrderIds.length === 0
      ? []
      : await tx
          .select({ id: wmsTables.sellmateHandedOverOrders.salesOrderId })
          .from(wmsTables.sellmateHandedOverOrders)
          .where(inArray(wmsTables.sellmateHandedOverOrders.salesOrderId, salesOrderIds))
          .limit(1);

  return {
    box,
    lines: unique.map((l) => ({
      lineId: l.lineId,
      fulfillmentOrderItemId: l.fulfillmentOrderItemId,
      fulfillmentOrderId: l.fulfillmentOrderId,
      skuId: l.skuId,
      skuName: l.skuName,
      stockType: l.stockType,
      qty: l.qty,
      reservedQty: l.reservedQty,
      createdAt: l.createdAt,
      demandRequestedAt: l.demandRequestedAt,
      linkedSupplierId: l.links.size === 1 ? [...l.links][0] : null,
    })),
    salesOrderIds,
    orderNo: unique.find((l) => l.orderNo)?.orderNo ?? null,
    foWarehouseId: foWarehouses.size === 1 ? ([...foWarehouses][0] ?? null) : null,
    activeWaybill: waybill !== undefined,
    activeWork: work ?? null,
    sellmateHandedOver: handedOver.length > 0,
    recipient: recipientOf(box.recipientSnapshot, box.entrancePassword),
  };
}

/** 창고 상자를 공급처에 맡길 수 없게 하는 것. 비면 맡길 수 있다. */
export function takeoverBlockers(facts: DirectDeliveryFacts): DirectDeliveryBlockerDto[] {
  const blockers: DirectDeliveryBlockerDto[] = [];
  const { box } = facts;
  if (box.status !== 'draft' || box.warehouseId === null) blockers.push({ code: 'not_draft' });
  if (box.recoveryCode !== null) blockers.push({ code: 'recovery' });
  if (facts.activeWork) blockers.push({ code: 'active_work', ...facts.activeWork });
  if (facts.activeWaybill) blockers.push({ code: 'active_waybill' });
  if (facts.lines.some((l) => l.stockType === 'drop_shipped')) blockers.push({ code: 'drop_shipped' });
  if (facts.sellmateHandedOver) blockers.push({ code: 'sellmate_handed_over' });
  if (facts.recipient === null) blockers.push({ code: 'recipient_incomplete' });
  return blockers;
}

/** 공급처 상자에 송장을 넣을 수 없게 하는 것. 비면 넣을 수 있다. */
export function dispatchBlockers(facts: DirectDeliveryFacts): DirectDeliveryBlockerDto[] {
  const blockers: DirectDeliveryBlockerDto[] = [];
  const { box } = facts;
  if (box.status !== 'draft' || box.supplierId === null) blockers.push({ code: 'not_draft' });
  if (box.recoveryCode !== null) blockers.push({ code: 'recovery' });
  if (facts.activeWaybill) blockers.push({ code: 'active_waybill' });
  if (box.supplierHandoffId === null && facts.recipient === null) blockers.push({ code: 'recipient_incomplete' });
  return blockers;
}

/** 공급처 상자를 창고 출고로 되돌릴 수 없게 하는 것. 비면 되돌릴 수 있다. */
export function returnBlockers(facts: DirectDeliveryFacts): DirectDeliveryBlockerDto[] {
  const blockers: DirectDeliveryBlockerDto[] = [];
  const { box } = facts;
  if (box.status !== 'draft' || box.supplierId === null) blockers.push({ code: 'not_draft' });
  if (box.recoveryCode !== null) blockers.push({ code: 'recovery' });
  if (facts.activeWaybill) blockers.push({ code: 'active_waybill' });
  if (facts.lines.some((l) => l.stockType === 'drop_shipped')) blockers.push({ code: 'drop_shipped' });
  if (facts.foWarehouseId === null) blockers.push({ code: 'no_warehouse' });
  return blockers;
}

@Injectable()
export class OneOrderDirectReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async preview(shipmentId: string, tx?: DbTx): Promise<DirectDeliveryPreviewDto> {
    return this.dbService.run(async (trx) => {
      const facts = await loadDirectDeliveryFacts(trx, shipmentId);
      const links = new Set(facts.lines.map((l) => l.linkedSupplierId));
      const suggested = links.size === 1 ? ([...links][0] ?? null) : null;
      const suppliers = await trx
        .select({ id: wmsTables.suppliers.id, name: wmsTables.suppliers.name })
        .from(wmsTables.suppliers)
        .orderBy(asc(wmsTables.suppliers.name));
      const owner = facts.box.supplierId === null ? 'warehouse' : 'supplier';
      return {
        shipmentId,
        owner,
        status: facts.box.status,
        manifestVersion: facts.box.manifestVersion,
        supplierId: facts.box.supplierId,
        handedOff: facts.box.supplierHandoffId !== null,
        salesOrderId: facts.salesOrderIds[0] ?? '',
        fulfillmentOrderId: facts.lines[0].fulfillmentOrderId,
        orderNo: facts.orderNo,
        lines: facts.lines.map((l) => ({
          lineId: l.lineId,
          skuId: l.skuId,
          skuName: l.skuName,
          qty: l.qty,
          reservedQty: l.reservedQty,
          linkedSupplierId: l.linkedSupplierId,
        })),
        suggestedSupplierId: suggested,
        suppliers,
        recipient: facts.recipient,
        blockers: owner === 'warehouse' ? takeoverBlockers(facts) : returnBlockers(facts),
        dispatchBlockers: owner === 'warehouse' ? [] : dispatchBlockers(facts),
      };
    }, tx);
  }

  /** 넘겼지만 송장이 아직 없는 공급처 상자 — 그 출고주문의 창고로 거른다. 오래 기다린 것부터. */
  async awaitingTracking(warehouseId: string, tx?: DbTx): Promise<DirectDeliveryAwaitingDto> {
    return this.dbService.run(async (trx) => {
      const { shipments, shipmentLines, skus, fulfillmentOrderItems, fulfillmentOrders, salesOrders, suppliers } =
        wmsTables;
      const handoffs = wmsTables.supplierHandoffs;
      const rows = await trx
        .select({
          shipmentId: shipments.id,
          manifestVersion: shipments.manifestVersion,
          salesOrderId: fulfillmentOrders.salesOrderId,
          fulfillmentOrderId: fulfillmentOrders.id,
          orderNo: orderNoSql(),
          supplierId: suppliers.id,
          supplierName: suppliers.name,
          handedOffAt: handoffs.createdAt,
          handedOffBy: handoffs.createdBy,
          skuName: skus.name,
          qty: shipmentLines.qty,
        })
        .from(shipments)
        .innerJoin(handoffs, eq(handoffs.id, shipments.supplierHandoffId))
        .innerJoin(suppliers, eq(suppliers.id, shipments.supplierId))
        .innerJoin(shipmentLines, eq(shipmentLines.shipmentId, shipments.id))
        .innerJoin(skus, eq(skus.id, shipmentLines.skuId))
        .innerJoin(fulfillmentOrderItems, eq(fulfillmentOrderItems.id, shipmentLines.fulfillmentOrderItemId))
        .innerJoin(fulfillmentOrders, eq(fulfillmentOrders.id, fulfillmentOrderItems.fulfillmentOrderId))
        .innerJoin(salesOrders, eq(salesOrders.id, fulfillmentOrders.salesOrderId))
        .where(
          and(
            isNotNull(shipments.supplierId),
            eq(shipments.status, 'draft'),
            isNull(shipments.recoveryCode),
            eq(fulfillmentOrders.warehouseId, warehouseId),
            sql`NOT EXISTS (
              SELECT 1 FROM waybills awt_w
               WHERE awt_w.shipment_id = ${shipments.id}
                 AND awt_w.status NOT IN (${sql.join(
                   WAYBILL_TERMINAL_STATUSES.map((status) => sql`${status}`),
                   sql`, `,
                 )})
            )`,
          ),
        )
        .orderBy(asc(handoffs.createdAt), asc(shipments.id), asc(shipmentLines.id))
        .limit(2000);

      const items = new Map<string, DirectDeliveryAwaitingDto['items'][number]>();
      for (const row of rows) {
        const seen = items.get(row.shipmentId);
        if (seen) {
          seen.lineCount += 1;
          seen.totalQty += row.qty;
          continue;
        }
        items.set(row.shipmentId, {
          shipmentId: row.shipmentId,
          manifestVersion: row.manifestVersion,
          salesOrderId: row.salesOrderId ?? '',
          fulfillmentOrderId: row.fulfillmentOrderId,
          orderNo: row.orderNo,
          supplierId: row.supplierId,
          supplierName: row.supplierName,
          handedOffAt: row.handedOffAt.toISOString(),
          handedOffBy: row.handedOffBy,
          firstSkuName: row.skuName,
          lineCount: 1,
          totalQty: row.qty,
        });
      }
      return { items: [...items.values()] };
    }, tx);
  }
}
