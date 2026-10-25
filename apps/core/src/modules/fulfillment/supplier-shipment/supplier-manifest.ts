import { asc, eq, inArray } from 'drizzle-orm';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { selectEntrancePasswordForMerge } from '../services/entrance-password.selection';
import { canonicalConsolidationRecipient } from '../services/consolidation.service';
import { ManifestEditDeps, editShipmentManifest } from '../shipment/shipment-manifest-edit';
import { mergedLinesByFoi } from '../shipment/merged-lines-by-foi';
import { transitionShipments } from '../shipment/shipment-lifecycle';
import { shipmentOwnerOf } from '../shipment/shipment-owner';
import { SupplierMergeRecipientMismatchError, SupplierShipmentNotEditableError } from './supplier-shipment.errors';

/** 새 상자의 `openedBy` 로 남는다(창고 합배송과 같다). */
export interface ManifestActor {
  actorId: string;
}

type BoxRow = typeof wmsTables.shipments.$inferSelect;

/** 나누기·합포장이 만지는 입점사 상자의 공통 조건. 호출자가 잠그기 전(낙관)과 잠근 뒤 두 번 쓴다. */
function assertEditableSupplierBox(box: BoxRow): string {
  if (box.supplierId === null) {
    throw new SupplierShipmentNotEditableError(`Shipment ${box.id} is a warehouse box`);
  }
  if (box.status !== 'draft' || box.recoveryCode !== null) {
    throw new SupplierShipmentNotEditableError(
      `Shipment ${box.id} is not editable (status ${box.status}, recovery ${box.recoveryCode ?? 'none'})`,
    );
  }
  const owner = shipmentOwnerOf(box);
  if (owner.kind !== 'supplier') throw new SupplierShipmentNotEditableError(`Shipment ${box.id} is a warehouse box`);
  return owner.supplierId;
}

async function readBoxes(tx: DbTx, ids: readonly string[]): Promise<BoxRow[]> {
  const rows = await tx
    .select()
    .from(wmsTables.shipments)
    .where(inArray(wmsTables.shipments.id, [...ids]));
  for (const id of ids) {
    if (!rows.some((row) => row.id === id)) throw new NotFoundError(`Shipment ${id} not found`);
  }
  return rows;
}

/**
 * 입점사 draft 상자에서 라인 몇 개를 떼어 새 draft 입점사 상자로 옮긴다. 라인 id 는 그대로다(`moveLine`).
 * 라인이 상자의 전부면 아무것도 옮기지 않고 원래 id 를 돌려준다(빈 상자는 예약 재계산이 던진다).
 * 새 상자는 원래 상자의 수령인·공동현관 비번·넘김 기록을 물려받고 송장 프로필은 없다.
 * 송장이 걸린 상자는 문이 거절하므로 송장 등록 전에 한다. 잠금 순서(FOI → 상자 → 라인)는 문이 지킨다.
 */
export async function splitOffSupplierLines(
  deps: ManifestEditDeps,
  tx: DbTx,
  shipmentId: string,
  lineIds: readonly string[],
  actor?: ManifestActor,
): Promise<string> {
  const moving = [...new Set(lineIds)];
  if (moving.length === 0) throw new BadRequestError('No lines to split off');
  const [seed] = await readBoxes(tx, [shipmentId]);
  assertEditableSupplierBox(seed);

  return editShipmentManifest(
    deps,
    { shipmentIds: [shipmentId], allow: ['draft'] },
    async (writer, aggregates) => {
      const aggregate = aggregates[0];
      const box = aggregate.shipment;
      const supplierId = assertEditableSupplierBox(box);
      const owned = new Set(aggregate.lines.map((line) => line.id));
      const foreign = moving.filter((id) => !owned.has(id));
      if (foreign.length > 0) {
        throw new SupplierShipmentNotEditableError(`Lines ${foreign.join(',')} are not in shipment ${shipmentId}`);
      }
      if (moving.length === owned.size) return shipmentId;

      const created = await writer.createShipment({
        owner: { kind: 'supplier', supplierId },
        status: 'draft',
        shippingProfileId: null,
        recipientSnapshot: box.recipientSnapshot,
        entrancePassword: box.entrancePassword,
        supplierHandoffId: box.supplierHandoffId,
        openedBy: actor?.actorId ?? box.openedBy,
        openedAt: box.openedAt ?? undefined,
      });
      for (const lineId of moving) await writer.moveLine(lineId, shipmentId, created.id);
      return created.id;
    },
    tx,
  );
}

/**
 * 같은 입점사의 draft 입점사 상자 둘 이상(서로 다른 주문)을 새 상자 하나로 합친다 — 창고 합배송과 같은 표현:
 * 새 상자에 FOI 당 줄 하나(수량 합, `createdFromLineId`), 원래 상자는 줄을 지닌 채 `draft → superseded`.
 * 수령인은 `canonicalConsolidationRecipient` 가 같아야 한다. 넘김 기록은 원래 상자들 중 가장 이른 묶음(N7).
 * 넘김 없는 상자를 넘긴 상자와 합치면 새 상자가 가장 이른 묶음을 물려받는다(N7) — 시트 적용은 넘긴 상자끼리만 합친다.
 * 창고 전용 조각(호환성 판정·예약 retarget·합배송 작업 기록)은 부르지 않는다.
 */
export async function mergeSupplierShipments(
  deps: ManifestEditDeps,
  tx: DbTx,
  shipmentIds: readonly string[],
  actor?: ManifestActor,
): Promise<string> {
  const ids = [...new Set(shipmentIds)];
  if (ids.length !== shipmentIds.length || ids.length < 2) {
    throw new BadRequestError('Merging needs two or more distinct shipments');
  }
  for (const box of await readBoxes(tx, ids)) assertEditableSupplierBox(box);

  return editShipmentManifest(
    deps,
    { shipmentIds: ids, allow: ['draft'] },
    async (writer, aggregates) => {
      const suppliers = new Set(aggregates.map((aggregate) => assertEditableSupplierBox(aggregate.shipment)));
      if (suppliers.size !== 1) {
        throw new SupplierShipmentNotEditableError('Shipments belong to different suppliers');
      }
      const [supplierId] = suppliers;
      const recipients = aggregates.map((aggregate) =>
        canonicalConsolidationRecipient(aggregate.shipment.recipientSnapshot),
      );
      const first = JSON.stringify(recipients[0]);
      if (recipients.some((recipient) => recipient === null || JSON.stringify(recipient) !== first)) {
        throw new SupplierMergeRecipientMismatchError('Shipments have different recipients');
      }

      const lineIds = aggregates.flatMap((aggregate) => aggregate.lines.map((line) => line.id));
      const orderDateRows = await tx
        .select({ lineId: wmsTables.shipmentLines.id, orderDate: wmsTables.salesOrders.orderDate })
        .from(wmsTables.shipmentLines)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
        )
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
        .where(inArray(wmsTables.shipmentLines.id, lineIds));
      const orderDateOfLine = new Map(orderDateRows.map((row) => [row.lineId, row.orderDate]));

      const handoffIds = [
        ...new Set(aggregates.map((a) => a.shipment.supplierHandoffId).filter((id): id is string => id !== null)),
      ];
      let handoffId: string | null = null;
      if (handoffIds.length > 0) {
        const [earliest] = await tx
          .select({ id: wmsTables.supplierHandoffs.id })
          .from(wmsTables.supplierHandoffs)
          .where(inArray(wmsTables.supplierHandoffs.id, handoffIds))
          .orderBy(asc(wmsTables.supplierHandoffs.createdAt), asc(wmsTables.supplierHandoffs.id))
          .limit(1);
        handoffId = earliest?.id ?? null;
      }

      const now = new Date();
      const target = await writer.createShipment({
        owner: { kind: 'supplier', supplierId },
        status: 'draft',
        shippingProfileId: null,
        recipientSnapshot: aggregates[0].shipment.recipientSnapshot,
        entrancePassword: selectEntrancePasswordForMerge(
          aggregates.map((aggregate) => ({
            entrancePassword: aggregate.shipment.entrancePassword,
            createdAt: aggregate.shipment.createdAt,
            orderDates: aggregate.lines.map((line) => orderDateOfLine.get(line.id) ?? null),
          })),
        ),
        supplierHandoffId: handoffId,
        openedBy: actor?.actorId,
        openedAt: now,
      });

      for (const { newLine } of mergedLinesByFoi(aggregates.flatMap((aggregate) => aggregate.lines))) {
        await writer.addLine(target.id, newLine);
      }

      await transitionShipments(tx, {
        shipmentIds: ids,
        from: ['draft'],
        to: 'superseded',
        at: now,
        stale: 'unreachable',
      });
      return target.id;
    },
    tx,
  );
}
