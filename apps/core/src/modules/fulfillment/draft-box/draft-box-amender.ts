import { ConflictException, Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { acquireStockAvailabilityLocks } from '../../inventory/shared/locks/stock-availability-lock';
import { canonicalFulfillmentRequestHash } from '../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { compatibleShippingProfileId } from '../services/shipping-profile';
import { shrinkDraftLines } from '../services/draft-line-shrink';
import {
  assertShipmentHasNoActiveWaybill,
  assertShipmentHasNoCustodyOrActiveWork,
  completeShipmentOperation,
  createShipmentOperation,
  loadShipmentAggregate,
  lockShipmentAggregate,
  shipmentSnapshot,
  ShipmentAggregate,
  ShipmentLineRow,
  ShipmentOperationMember,
  ShipmentRow,
} from '../services/shipment-aggregate';
import { BoxTarget, diffBox } from './box-target';

export interface AmendResult {
  changed: boolean;
  operationId: string | null;
  manifestVersion: number;
  tombstoneShipmentId: string | null;
}

/**
 * 작성 중(draft) 박스를 목표 내용에 맞춘다(#1063 스펙 §6.3). 라인 구성 변경과 S2(주문 수정 전파)가 같은 실행부를 쓴다.
 * 줄어든 수량은 FO 항목 qty 를 줄인다 — canceledQty 는 고객 취소로 읽혀(출고 완료 판정·환불) 쓰면 안 된다.
 */
@Injectable()
export class DraftBoxAmender {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reservations: ShipmentReservationService,
    private readonly invariant: FulfillmentInvariantService,
    private readonly audit: AuditService,
  ) {}

  async amend(
    shipmentId: string,
    target: BoxTarget,
    reason: string,
    actor: { id: string },
    tx?: DbTx,
  ): Promise<AmendResult> {
    return this.dbService.run(async (trx) => {
      const aggregate = await lockShipmentAggregate(trx, this.invariant, shipmentId);
      if (aggregate.shipment.status !== 'draft') {
        throw new ConflictException({
          code: 'BOX_NOT_DRAFT',
          message: `Shipment ${shipmentId} must be Draft to amend`,
        });
      }
      // 상태만 draft 이고 작업·보관·송장에 묶인 박스가 있다 — 분할과 같은 가드
      await assertShipmentHasNoCustodyOrActiveWork(trx, aggregate);
      await assertShipmentHasNoActiveWaybill(trx, shipmentId);

      const diff = diffBox(
        aggregate.lines.map((line) => ({
          shipmentLineId: line.id,
          salesOrderLineId: line.salesOrderLineId,
          skuId: line.skuId,
          qty: line.qty,
        })),
        target,
      );
      const manifestVersion = aggregate.shipment.manifestVersion;
      if (diff.decreases.length === 0 && diff.increases.length === 0) {
        return { changed: false, operationId: null, manifestVersion, tombstoneShipmentId: null };
      }
      const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));
      const lineOf = (id: string): ShipmentLineRow => {
        const line = lineById.get(id);
        if (!line) throw new Error(`Shipment line ${id} is not in ${shipmentId}`);
        return line;
      };
      const totalAfter =
        aggregate.lines.reduce((total, line) => total + line.qty, 0) -
        diff.decreases.reduce((total, entry) => total + entry.qty, 0) +
        diff.increases.reduce((total, entry) => total + entry.qty, 0);
      // 박스를 비우는 것은 취소다(cancelOutstanding) — amend 로 흉내 내면 묘비·박스 상태 규칙이 갈린다
      if (totalAfter === 0) {
        throw new ConflictException({
          code: 'AMEND_WOULD_EMPTY_BOX',
          message: `Amend would empty shipment ${shipmentId}`,
        });
      }

      // FO 생성과 같은 규칙: 재고 키를 SKU 정렬 순으로 먼저 잡는다(예약 해제·추가가 다시 들어와도 안전)
      await acquireStockAvailabilityLocks(
        trx,
        [
          ...diff.decreases.map((entry) => lineOf(entry.shipmentLineId).skuId),
          ...diff.increases.map((entry) => entry.skuId),
        ].map((skuId) => ({ skuId, warehouseId: aggregate.shipment.warehouseId })),
      );

      const before = shipmentSnapshot(aggregate);
      const operation = await createShipmentOperation(trx, {
        type: 'amend',
        actorId: actor.id,
        reason,
        csCaseId: null,
        note: null,
        // manifestVersion 이 amend 마다 오르므로 박스·버전 쌍이 자연 키다
        idempotencyKey: `amend:${shipmentId}:${manifestVersion}`,
        requestHash: canonicalFulfillmentRequestHash({ shipmentId, manifestVersion, target }),
        before,
      });

      // 줄어듦 먼저 — 늘림의 reservePartial 이 불변식(qty = 정산 + 활성 줄)을 검사하기 전에 줄·FO 항목이 맞아야 한다
      let tombstone: ShipmentRow | null = null;
      if (diff.decreases.length > 0) {
        ({ tombstone } = await shrinkDraftLines(
          this.reservations,
          {
            shipment: aggregate.shipment,
            lines: diff.decreases.map((entry) => ({ line: lineOf(entry.shipmentLineId), qty: entry.qty })),
            reason,
            actorId: actor.id,
            wholeShipment: false,
          },
          trx,
        ));
        const decreaseByItem = new Map<string, number>();
        for (const entry of diff.decreases) {
          const itemId = lineOf(entry.shipmentLineId).fulfillmentOrderItemId;
          decreaseByItem.set(itemId, (decreaseByItem.get(itemId) ?? 0) + entry.qty);
        }
        for (const [itemId, qty] of decreaseByItem) {
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({ qty: sql`${wmsTables.fulfillmentOrderItems.qty} - ${qty}`, updatedAt: new Date() })
            .where(eq(wmsTables.fulfillmentOrderItems.id, itemId));
        }
      }

      const toReserve: Array<{ shipmentLineId: string; qty: number }> = [];
      for (const entry of diff.increases) {
        if (entry.shipmentLineId) {
          const line = lineOf(entry.shipmentLineId);
          // (FO, 라인, SKU) 항목은 유일하지 않다 — 줄이 매달린 그 항목을 늘려야 불변식(항목 qty = 활성 줄 합)이 맞는다
          await this.growKnownItem(trx, line.fulfillmentOrderItemId, entry.qty);
          await trx
            .update(wmsTables.shipmentLines)
            .set({ qty: line.qty + entry.qty, lineVersion: line.lineVersion + 1 })
            .where(eq(wmsTables.shipmentLines.id, line.id));
          toReserve.push({ shipmentLineId: line.id, qty: entry.qty });
        } else {
          const fulfillmentOrderId = this.fulfillmentOrderOfLine(aggregate, entry.salesOrderLineId);
          const itemId = await this.growItem(trx, fulfillmentOrderId, entry.salesOrderLineId, entry.skuId, entry.qty);
          const [inserted] = await trx
            .insert(wmsTables.shipmentLines)
            .values({ shipmentId, fulfillmentOrderItemId: itemId, skuId: entry.skuId, qty: entry.qty })
            .returning({ id: wmsTables.shipmentLines.id });
          toReserve.push({ shipmentLineId: inserted.id, qty: entry.qty });
        }
      }
      // 재고가 모자라면 가능한 만큼만 잡힌다 — FO 생성과 같이 거절하지 않고 박스는 draft 로 남는다(스펙 §7.3)
      for (const entry of toReserve.sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId))) {
        await this.reservations.reservePartial(entry.shipmentLineId, entry.qty, trx);
      }

      const changedLines = await loadShipmentAggregate(trx, shipmentId);
      const skuRows = await trx
        .select({ deliveryProfileId: wmsTables.skus.deliveryProfileId })
        .from(wmsTables.skus)
        .where(inArray(wmsTables.skus.id, [...new Set(changedLines.lines.map((line) => line.skuId))]));
      await trx
        .update(wmsTables.shipments)
        .set({
          shippingProfileId: compatibleShippingProfileId(skuRows.map((row) => row.deliveryProfileId)),
          manifestVersion: manifestVersion + 1,
          lastUpdated: new Date(),
        })
        .where(eq(wmsTables.shipments.id, shipmentId));
      for (const fulfillmentOrderId of aggregate.fulfillmentOrderIds) {
        await this.recomputeTotals(trx, fulfillmentOrderId);
      }
      await this.reservations.recompute(shipmentId, trx);
      if (tombstone) await this.reservations.recompute(tombstone.id, trx);

      const after = shipmentSnapshot(await loadShipmentAggregate(trx, shipmentId));
      const members: ShipmentOperationMember[] = [{ shipmentId, role: 'source', before, after }];
      if (tombstone) {
        members.push({
          shipmentId: tombstone.id,
          role: 'target',
          before: null,
          after: shipmentSnapshot(await loadShipmentAggregate(trx, tombstone.id)),
        });
      }
      await completeShipmentOperation(trx, operation.id, members);
      await this.audit.logUserActionRequired(
        'shipment.amend',
        'fulfillment',
        `shipment.amend operation ${operation.id}`,
        { userId: actor.id },
        { operationId: operation.id, reason, shipmentId, target, before, after },
        trx,
      );
      return {
        changed: true,
        operationId: operation.id,
        manifestVersion: manifestVersion + 1,
        tombstoneShipmentId: tombstone?.id ?? null,
      };
    }, tx);
  }

  /** 목표의 라인은 이 박스에 이미 줄이 있어야 한다 — 박스에 없던 라인을 들이는 것(합류)은 S1/S2 의 일이다. */
  private fulfillmentOrderOfLine(aggregate: ShipmentAggregate, salesOrderLineId: string): string {
    const line = aggregate.lines.find((candidate) => candidate.salesOrderLineId === salesOrderLineId);
    if (!line) throw new Error(`Line ${salesOrderLineId} has no rows in shipment ${aggregate.shipment.id}`);
    return line.fulfillmentOrderId;
  }

  private async growKnownItem(trx: DbTx, fulfillmentOrderItemId: string, qty: number): Promise<void> {
    const items = wmsTables.fulfillmentOrderItems;
    await trx
      .update(items)
      .set({ qty: sql`${items.qty} + ${qty}`, updatedAt: new Date() })
      .where(eq(items.id, fulfillmentOrderItemId));
  }

  /** (FO, 라인, SKU) 항목의 수요를 늘린다. 없으면 같은 라인의 항목을 본떠 만든다 — qty 0 으로 대체됐던 항목도 되살린다. */
  private async growItem(
    trx: DbTx,
    fulfillmentOrderId: string,
    salesOrderLineId: string,
    skuId: string,
    qty: number,
  ): Promise<string> {
    const items = wmsTables.fulfillmentOrderItems;
    const sameLine = and(
      eq(items.fulfillmentOrderId, fulfillmentOrderId),
      eq(items.salesOrderLineId, salesOrderLineId),
    );
    const [existing] = await trx
      .select({ id: items.id })
      .from(items)
      .where(and(sameLine, eq(items.skuId, skuId)))
      .orderBy(asc(items.id))
      .limit(1);
    if (existing) {
      await this.growKnownItem(trx, existing.id, qty);
      return existing.id;
    }
    const [template] = await trx
      .select({ salesOrderId: items.salesOrderId, variantId: items.variantId })
      .from(items)
      .where(sameLine)
      .orderBy(asc(items.id))
      .limit(1);
    if (!template) throw new Error(`No fulfillment item to copy for line ${salesOrderLineId}`);
    const [inserted] = await trx
      .insert(items)
      .values({
        fulfillmentOrderId,
        salesOrderId: template.salesOrderId,
        salesOrderLineId,
        variantId: template.variantId,
        skuId,
        qty,
        status: 'pending',
      })
      .returning({ id: items.id });
    return inserted.id;
  }

  private async recomputeTotals(trx: DbTx, fulfillmentOrderId: string): Promise<void> {
    const items = wmsTables.fulfillmentOrderItems;
    const [totals] = await trx
      .select({
        // qty 0 항목(대체됨)은 품목 수에 세지 않는다
        totalItems: sql<number>`count(*) filter (where ${items.qty} > 0)::int`,
        totalQty: sql<number>`coalesce(sum(${items.qty}), 0)::int`,
      })
      .from(items)
      .where(eq(items.fulfillmentOrderId, fulfillmentOrderId));
    await trx
      .update(wmsTables.fulfillmentOrders)
      .set({ totalItems: totals.totalItems, totalQty: totals.totalQty, updatedAt: new Date() })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
  }
}
