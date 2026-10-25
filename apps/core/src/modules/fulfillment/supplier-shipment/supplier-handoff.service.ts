import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { formatInTimeZone } from 'date-fns-tz';
import { DbService, InjectTypedDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { lockShipmentConnectedComponentGraph } from '../services/shipment-reservation.service';
import { parseRecipient } from '../waybill/waybill-request.assembler';
import { hasOrderLine, orderNoSql } from './supplier-shipment-queue.reader';
import { SUPPLIER_SHEET_COLUMNS, type SupplierSheetKey } from './supplier-sheet.columns';
import { SupplierHandoffEmptyError, SupplierHandoffRecipientIncompleteError } from './supplier-shipment.errors';

/** 시트 한 줄 — 열 키 전부 + 개인정보 접속기록의 대상 식별자(`salesOrderId`, 시트 열이 아니다). */
export type SupplierSheetRow = Record<Exclude<SupplierSheetKey, 'qty'>, string> & { qty: number; salesOrderId: string };

export type SupplierSheet = {
  handoffId: string;
  supplierId: string;
  fileName: string;
  columns: typeof SUPPLIER_SHEET_COLUMNS;
  rows: SupplierSheetRow[];
  /** 수령인 정보가 불완전해 싣지 못한 상자 — 넘김은 찍지 않았다(대기 그대로) */
  skippedShipments: SupplierSheetSkippedShipment[];
};

export type SupplierSheetSkippedShipment = { shipmentId: string; reason: 'RECIPIENT_INCOMPLETE' };

/** `직배_${입점사 이름}_${KST yyyyMMdd-HHmm}.xlsx` — 파일명에 못 쓰는 글자는 `_`. */
export function supplierSheetFileName(supplierName: string, at: Date): string {
  const safe = supplierName.replace(/[\\/:*?"<>|]/g, '_');
  return `직배_${safe}_${formatInTimeZone(at, 'Asia/Seoul', 'yyyyMMdd-HHmm')}.xlsx`;
}

type RecipientCells = { name: string; phone: string; address: string; memo: string };

/** 창고 송장과 같은 파서(`parseRecipient`) 로 읽는다 — 불완전하면 던진다. */
function recipientCells(snapshot: unknown): RecipientCells {
  const r = parseRecipient(snapshot);
  const street = [r.roadAddress, r.detailAddress].filter(Boolean).join(' ');
  return {
    name: r.recipientName,
    phone: r.phone,
    address: r.postalCode ? `(${r.postalCode}) ${street}` : street,
    memo: r.deliveryNote ?? '',
  };
}

function isRecipientComplete(snapshot: unknown): boolean {
  try {
    parseRecipient(snapshot);
    return true;
  } catch (e) {
    if (e instanceof BadRequestError) return false;
    throw e;
  }
}

/** 상자별 수령인 완전성으로 나눈다. */
function partitionByRecipient<T extends { shipmentId: string; recipientSnapshot: unknown }>(boxes: T[]) {
  const complete = boxes.filter((b) => isRecipientComplete(b.recipientSnapshot));
  const skipped: SupplierSheetSkippedShipment[] = boxes
    .filter((b) => !isRecipientComplete(b.recipientSnapshot))
    .map((b) => ({ shipmentId: b.shipmentId, reason: 'RECIPIENT_INCOMPLETE' }));
  return { complete, skipped };
}

/**
 * 넘김(K3 PR5, N5) — 입점사의 넘기지 않은 상자에 새 묶음을 찍고 시트를 돌려준다. 다시 받기는 같은 묶음의 draft 상자를 다시 싣는다.
 * 상자의 `supplierHandoffId` 는 이 폴더(supplier-shipment/)에서만 쓴다(shipment-writes.guard).
 */
@Injectable()
export class SupplierHandoffService {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async handOff(supplierId: string, actorId: string, tx?: DbTx): Promise<SupplierSheet> {
    return this.dbService.run(async (trx) => {
      const { shipments, shipmentLines, supplierHandoffs } = wmsTables;
      const supplier = await this.loadSupplier(trx, supplierId);
      // 넘길 상자: 정상(회수 중 아님) draft, 아직 안 넘김, 판매주문 라인 있음 — 직배 목록의 «대기» 단계와 같은 술어(+ recovery_code)
      const candidate = and(
        eq(shipments.supplierId, supplierId),
        eq(shipments.status, 'draft'),
        isNull(shipments.supplierHandoffId),
        isNull(shipments.recoveryCode),
        hasOrderLine(shipments.id),
      );
      const seedRows = await trx
        .selectDistinct({
          shipmentId: shipments.id,
          recipientSnapshot: shipments.recipientSnapshot,
          foiId: shipmentLines.fulfillmentOrderItemId,
        })
        .from(shipments)
        .innerJoin(shipmentLines, eq(shipmentLines.shipmentId, shipments.id))
        .where(candidate);
      if (seedRows.length === 0)
        throw new SupplierHandoffEmptyError(`Supplier ${supplierId} has no shipments to hand off`);

      // 수령인이 불완전한 상자는 넘기지 않는다(대기 그대로) — 시트에 빈 칸으로 실리면 입점사가 보낼 수 없다
      const boxes = [...new Map(seedRows.map((r) => [r.shipmentId, r])).values()];
      const { complete, skipped } = partitionByRecipient(boxes);
      if (complete.length === 0) {
        throw new SupplierHandoffRecipientIncompleteError(
          `Supplier ${supplierId} shipments have incomplete recipients: ${skipped.map((k) => k.shipmentId).join(',')}`,
        );
      }
      const seedShipmentIds = complete.map((b) => b.shipmentId);
      const seedFoiIds = seedRows.filter((r) => seedShipmentIds.includes(r.shipmentId)).map((r) => r.foiId);

      // 공유 락 순서(FOI → 상자 → 라인) — 락 뒤에 상자를 다시 읽어 판정한다.
      // 시드 상자만 다시 잠근다: 그 뒤에 생긴 상자는 FOI 를 안 잠갔으므로 다음 넘김으로 간다.
      await lockShipmentConnectedComponentGraph(trx, seedFoiIds);
      const locked = await trx
        .select({ id: shipments.id })
        .from(shipments)
        .where(and(candidate, inArray(shipments.id, seedShipmentIds)))
        .orderBy(asc(shipments.id))
        .for('update');
      if (locked.length === 0)
        throw new SupplierHandoffEmptyError(`Supplier ${supplierId} has no shipments to hand off`);

      const [handoff] = await trx.insert(supplierHandoffs).values({ supplierId, createdBy: actorId }).returning();
      const ids = locked.map((b) => b.id);
      const stamped = await trx
        .update(shipments)
        .set({ supplierHandoffId: handoff.id })
        .where(and(inArray(shipments.id, ids), isNull(shipments.supplierHandoffId)))
        .returning({ id: shipments.id });
      if (stamped.length !== ids.length) {
        throw new Error(`Supplier handoff ${handoff.id} stamped ${stamped.length} of ${ids.length} locked shipments`);
      }
      return this.buildSheet(trx, handoff, supplier.name, ids, skipped);
    }, tx);
  }

  async sheet(handoffId: string, tx?: DbTx): Promise<SupplierSheet> {
    return this.dbService.run(async (trx) => {
      const { shipments, supplierHandoffs } = wmsTables;
      const [handoff] = await trx.select().from(supplierHandoffs).where(eq(supplierHandoffs.id, handoffId)).limit(1);
      if (!handoff) throw new NotFoundError(`Supplier handoff ${handoffId} not found`);
      const supplier = await this.loadSupplier(trx, handoff.supplierId);
      const boxes = await trx
        .select({ shipmentId: shipments.id, recipientSnapshot: shipments.recipientSnapshot })
        .from(shipments)
        .where(
          and(
            eq(shipments.supplierHandoffId, handoffId),
            eq(shipments.status, 'draft'),
            isNull(shipments.recoveryCode),
            hasOrderLine(shipments.id),
          ),
        );
      const { complete, skipped } = partitionByRecipient(boxes);
      return this.buildSheet(
        trx,
        handoff,
        supplier.name,
        complete.map((b) => b.shipmentId),
        skipped,
      );
    }, tx);
  }

  private async loadSupplier(trx: DbTx, supplierId: string): Promise<{ name: string }> {
    const [supplier] = await trx
      .select({ name: wmsTables.suppliers.name })
      .from(wmsTables.suppliers)
      .where(eq(wmsTables.suppliers.id, supplierId))
      .limit(1);
    if (!supplier) throw new NotFoundError(`Supplier ${supplierId} not found`);
    return supplier;
  }

  private async buildSheet(
    trx: DbTx,
    handoff: { id: string; supplierId: string; createdAt: Date },
    supplierName: string,
    shipmentIds: string[],
    skippedShipments: SupplierSheetSkippedShipment[],
  ): Promise<SupplierSheet> {
    const rows = shipmentIds.length === 0 ? [] : await this.loadRows(trx, handoff.supplierId, shipmentIds);
    return {
      handoffId: handoff.id,
      supplierId: handoff.supplierId,
      fileName: supplierSheetFileName(supplierName, handoff.createdAt),
      columns: SUPPLIER_SHEET_COLUMNS,
      rows,
      skippedShipments,
    };
  }

  private async loadRows(trx: DbTx, supplierId: string, shipmentIds: string[]): Promise<SupplierSheetRow[]> {
    const { shipments, shipmentLines, fulfillmentOrderItems, fulfillmentOrders, salesOrders, skus, skuSuppliers } =
      wmsTables;
    const lines = await trx
      .select({
        foiId: shipmentLines.fulfillmentOrderItemId,
        productName: skus.name,
        supplierSku: skuSuppliers.supplierSku,
        qty: shipmentLines.qty,
        unfulfillableReason: shipmentLines.unfulfillableReason,
        salesOrderId: salesOrders.id,
        orderNo: orderNoSql(),
        recipientSnapshot: shipments.recipientSnapshot,
        entrancePassword: shipments.entrancePassword,
      })
      .from(shipmentLines)
      .innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
      .innerJoin(skus, eq(skus.id, shipmentLines.skuId))
      .innerJoin(fulfillmentOrderItems, eq(fulfillmentOrderItems.id, shipmentLines.fulfillmentOrderItemId))
      .innerJoin(fulfillmentOrders, eq(fulfillmentOrders.id, fulfillmentOrderItems.fulfillmentOrderId))
      .innerJoin(salesOrders, eq(salesOrders.id, fulfillmentOrders.salesOrderId))
      .leftJoin(skuSuppliers, and(eq(skuSuppliers.skuId, shipmentLines.skuId), eq(skuSuppliers.supplierId, supplierId)))
      .where(inArray(shipmentLines.shipmentId, shipmentIds))
      .orderBy(asc(orderNoSql()), asc(skus.name), asc(shipmentLines.fulfillmentOrderItemId));

    // N3: 한 FOI 의 살아 있는 입점사 라인은 하나 — 행 키(FOI id)가 시트에서 유일해야 한다
    const seen = new Set<string>();
    for (const l of lines) {
      if (seen.has(l.foiId)) throw new Error(`Supplier sheet has duplicate row key (FOI ${l.foiId})`);
      seen.add(l.foiId);
    }

    return lines.map((l) => {
      const r = recipientCells(l.recipientSnapshot);
      return {
        rowKey: l.foiId,
        orderNo: l.orderNo,
        productName: l.productName,
        supplierSku: l.supplierSku ?? '',
        qty: l.qty,
        recipientName: r.name,
        recipientPhone: r.phone,
        address: r.address,
        entrancePassword: l.entrancePassword ?? '',
        deliveryMemo: r.memo,
        carrier: '',
        trackingNo: '',
        unfulfillableReason: l.unfulfillableReason ?? '',
        salesOrderId: l.salesOrderId,
      };
    });
  }
}
