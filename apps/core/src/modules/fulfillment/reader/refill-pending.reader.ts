import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { maskName, readRecipientName } from './shipment-waybill.reader';

export interface RefillSnapshot {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

export interface RefillPendingItem {
  shipmentLineId: string;
  skuId: string;
  skuName: string;
  sourceLocationId: string;
  locationCode: string;
  /** 아직 안 집은 채운 몫 */
  qty: number;
}

export interface RefillPendingBox {
  shipmentId: string;
  trackingNo: string | null;
  recipientMasked: string;
  items: RefillPendingItem[];
}

/** 보충이 남아 있을 수 있는 작업 항목 — 출고·제외(종결)와 빼는 중은 보충 대상이 아니다. */
const NOT_REFILLABLE_WORK_ITEM_STATUSES = ['completed', 'excluded', 'withdrawing'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 결품 오퍼레이션 after 스냅샷(`completeRefilled` 가 쓴다)에서 채운 행만. 모양이 틀린 행은 버린다. */
export function readRefills(after: unknown): RefillSnapshot[] {
  if (!isRecord(after) || after.outcome !== 'refilled' || !Array.isArray(after.refills)) return [];
  const list: unknown[] = after.refills;
  return list.flatMap((row) =>
    isRecord(row) &&
    typeof row.shipmentLineId === 'string' &&
    typeof row.skuId === 'string' &&
    typeof row.sourceLocationId === 'string' &&
    typeof row.locationCode === 'string' &&
    typeof row.qty === 'number'
      ? [
          {
            shipmentLineId: row.shipmentLineId,
            skuId: row.skuId,
            sourceLocationId: row.sourceLocationId,
            locationCode: row.locationCode,
            qty: row.qty,
          },
        ]
      : [],
  );
}

/** 결품 오퍼레이션 before 스냅샷의 의도(`ShortPickOperationIntentProof`)가 가리키는 작업 항목. */
export function readIntentWorkItemId(before: unknown): string | null {
  if (!isRecord(before) || !isRecord(before.intent)) return null;
  return typeof before.intent.workItemId === 'string' ? before.intent.workItemId : null;
}

const key = (shipmentLineId: string, sourceLocationId: string) => `${shipmentLineId}:${sourceLocationId}`;

/**
 * 스테이션 «보충 대기»(스펙 §7.3·A6). 결품을 다른 위치에서 채운 박스 중, 채운 몫을 아직 집지 않은 것.
 * 남은 몫 = 그 (줄, 위치) 배정 − 줄에 귀속된 보관(SETTLED 제외, `SimpleOutboundService.attributedQty` 와 같은 집계).
 */
@Injectable()
export class RefillPendingReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  pending(warehouseId: string, tx?: DbTx): Promise<RefillPendingBox[]> {
    return this.dbService.run(async (trx) => {
      const operations = await trx
        .select({
          shipmentId: wmsTables.shipmentOperationMembers.shipmentId,
          before: wmsTables.shipmentOperations.beforeManifestSnapshot,
          after: wmsTables.shipmentOperations.afterManifestSnapshot,
          recipientSnapshot: wmsTables.shipments.recipientSnapshot,
        })
        .from(wmsTables.shipmentOperations)
        .innerJoin(
          wmsTables.shipmentOperationMembers,
          and(
            eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
            eq(wmsTables.shipmentOperationMembers.role, 'source'),
          ),
        )
        .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentOperationMembers.shipmentId))
        .where(
          and(
            eq(wmsTables.shipmentOperations.type, 'short_pick'),
            eq(wmsTables.shipmentOperations.status, 'completed'),
            sql`${wmsTables.shipmentOperations.afterManifestSnapshot}->>'outcome' = 'refilled'`,
            eq(wmsTables.shipments.warehouseId, warehouseId),
            eq(wmsTables.shipments.status, 'planned'),
          ),
        )
        .orderBy(asc(wmsTables.shipmentOperations.completedAt));

      // 같은 박스의 여러 결품을 하나로 모은다 — (작업 항목, 줄, 위치)별 채운 수량 합.
      const boxes = new Map<
        string,
        { shipmentId: string; workItemId: string; recipientSnapshot: unknown; refilled: Map<string, RefillSnapshot> }
      >();
      for (const operation of operations) {
        const workItemId = readIntentWorkItemId(operation.before);
        if (!workItemId) continue;
        const box = boxes.get(workItemId) ?? {
          shipmentId: operation.shipmentId,
          workItemId,
          recipientSnapshot: operation.recipientSnapshot,
          refilled: new Map<string, RefillSnapshot>(),
        };
        for (const refill of readRefills(operation.after)) {
          const k = key(refill.shipmentLineId, refill.sourceLocationId);
          const prev = box.refilled.get(k);
          box.refilled.set(k, prev ? { ...prev, qty: prev.qty + refill.qty } : refill);
        }
        boxes.set(workItemId, box);
      }
      if (!boxes.size) return [];

      const workItems = await trx
        .select({ id: wmsTables.outboundBatchWorkItems.id, batchId: wmsTables.outboundBatchWorkItems.batchId })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            inArray(wmsTables.outboundBatchWorkItems.id, [...boxes.keys()]),
            notInArray(wmsTables.outboundBatchWorkItems.status, [...NOT_REFILLABLE_WORK_ITEM_STATUSES]),
          ),
        );

      // 오퍼레이션 완료 순(`boxes` 삽입 순)을 지킨다 — inArray 결과 순서에 기대면 폴링마다 목록이 섞일 수 있다.
      const workItemById = new Map(workItems.map((workItem) => [workItem.id, workItem]));
      const result: RefillPendingBox[] = [];
      for (const box of boxes.values()) {
        const workItem = workItemById.get(box.workItemId);
        if (!workItem) continue;
        const [session] = await trx
          .select({ id: wmsTables.batchInventorySessions.id })
          .from(wmsTables.batchInventorySessions)
          .where(
            and(
              eq(wmsTables.batchInventorySessions.batchId, workItem.batchId),
              eq(wmsTables.batchInventorySessions.status, 'active'),
            ),
          )
          .limit(1);
        if (!session) continue;
        const remaining = await this.remainingByKey(trx, workItem.id, session.id);
        const items: RefillPendingItem[] = [];
        for (const [k, refill] of box.refilled) {
          const left = Math.min(refill.qty, remaining.get(k) ?? 0);
          if (left > 0) items.push({ ...refill, skuName: '', qty: left });
        }
        if (!items.length) continue;
        result.push({
          shipmentId: box.shipmentId,
          trackingNo: await this.activeTrackingNo(trx, box.shipmentId),
          recipientMasked: maskName(readRecipientName(box.recipientSnapshot)),
          items,
        });
      }

      const skuIds = [...new Set(result.flatMap((box) => box.items.map((item) => item.skuId)))];
      if (skuIds.length) {
        const skus = await trx
          .select({ id: wmsTables.skus.id, name: wmsTables.skus.name })
          .from(wmsTables.skus)
          .where(inArray(wmsTables.skus.id, skuIds));
        const nameById = new Map(skus.map((sku) => [sku.id, sku.name]));
        for (const box of result) for (const item of box.items) item.skuName = nameById.get(item.skuId) ?? '';
      }
      return result;
    }, tx);
  }

  /** (줄, 위치)별 «배정 − 줄 귀속 보관». */
  private async remainingByKey(trx: DbTx, workItemId: string, sessionId: string): Promise<Map<string, number>> {
    const allocations = await trx
      .select({
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId));
    const held = await trx
      .select({
        shipmentLineId: wmsTables.batchInventorySessionBalances.shipmentLineId,
        sourceLocationId: wmsTables.batchInventorySessionBalances.sourceLocationId,
        qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int`,
      })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      )
      .groupBy(
        wmsTables.batchInventorySessionBalances.shipmentLineId,
        wmsTables.batchInventorySessionBalances.sourceLocationId,
      );
    const heldByKey = new Map<string, number>();
    for (const row of held) {
      if (row.shipmentLineId && row.sourceLocationId)
        heldByKey.set(key(row.shipmentLineId, row.sourceLocationId), Number(row.qty));
    }
    const remaining = new Map<string, number>();
    for (const row of allocations) {
      const k = key(row.shipmentLineId, row.sourceLocationId);
      remaining.set(k, (remaining.get(k) ?? 0) + row.qty - (heldByKey.get(k) ?? 0));
    }
    return remaining;
  }

  private async activeTrackingNo(trx: DbTx, shipmentId: string): Promise<string | null> {
    const [waybill] = await trx
      .select({ trackingNo: wmsTables.waybills.trackingNo })
      .from(wmsTables.waybills)
      .where(
        and(
          eq(wmsTables.waybills.shipmentId, shipmentId),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      )
      .limit(1);
    return waybill?.trackingNo ?? null;
  }
}
