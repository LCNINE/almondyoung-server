import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { LINE_ATTRIBUTED_CUSTODY_TYPES } from '../services/line-attributed-custody';
import { labelLocationCode } from '../waybill/label/label-items';

/** 아직 집을 일이 남을 수 있는 상자. 끝난·빠진·빠지는 중·결품 복구 중인 상자는 목록에 넣지 않는다 */
export const PICK_LIST_WORK_ITEM_STATUSES = ['queued', 'picking', 'ready_to_pack', 'packing'] as const;

export interface BatchPickListRow {
  locationCode: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  pickedQty: number;
  boxes: number;
}

export interface BatchPickList {
  batchId: string;
  batchNumber: string;
  startedAt: Date | null;
  boxes: number;
  rows: BatchPickListRow[];
}

const codepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 배치 피킹 목록 — 배정을 (송장에 찍히는 위치, SKU) 로 합친다. 위치 코드 순이 동선이다.
 * 집은 수량은 활성 세션에서 그 (줄, 출발 위치)에 귀속된 보관 합이다(송장 조회의 배정별 집은 수량과 같은 정의).
 */
@Injectable()
export class BatchPickListReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async forBatch(batchId: string, tx?: DbTx): Promise<BatchPickList> {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select({
          id: wmsTables.outboundBatches.id,
          batchNumber: wmsTables.outboundBatches.batchNumber,
          startedAt: wmsTables.outboundBatches.startedAt,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      const empty = {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        startedAt: batch.startedAt,
        boxes: 0,
        rows: [],
      };
      if (!batch.startedAt) return empty;

      const allocations = await trx
        .select({
          workItemId: wmsTables.pickingSourceAllocations.workItemId,
          shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
          sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
          qty: wmsTables.pickingSourceAllocations.qty,
          skuId: wmsTables.shipmentLines.skuId,
          skuCode: wmsTables.skus.code,
          skuName: wmsTables.skus.name,
          locationCode: wmsTables.locations.code,
          systemRole: wmsTables.locations.systemRole,
          shelfCode: wmsTables.skuShelfPositions.positionCode,
        })
        .from(wmsTables.pickingSourceAllocations)
        .innerJoin(
          wmsTables.outboundBatchWorkItems,
          eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
        )
        .innerJoin(
          wmsTables.shipmentLines,
          eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
        )
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
        .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.pickingSourceAllocations.sourceLocationId))
        .leftJoin(wmsTables.skuShelfPositions, eq(wmsTables.skuShelfPositions.skuId, wmsTables.shipmentLines.skuId))
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
            inArray(wmsTables.outboundBatchWorkItems.status, [...PICK_LIST_WORK_ITEM_STATUSES]),
            gt(wmsTables.pickingSourceAllocations.qty, 0),
          ),
        );
      if (allocations.length === 0) return empty;

      const picked = await this.attributedPicks(trx, batchId);
      const byKey = new Map<string, BatchPickListRow & { workItems: Set<string> }>();
      const boxes = new Set<string>();
      for (const row of allocations) {
        const workItemId = row.workItemId ?? '';
        boxes.add(workItemId);
        const locationCode = labelLocationCode(row);
        const key = `${locationCode}\u0000${row.skuId}`;
        const entry = byKey.get(key) ?? {
          locationCode,
          skuId: row.skuId,
          skuCode: row.skuCode,
          skuName: row.skuName,
          qty: 0,
          pickedQty: 0,
          boxes: 0,
          workItems: new Set<string>(),
        };
        entry.qty += row.qty;
        // 귀속 보관이 배정보다 많아도(배정이 줄어든 직후) 이 줄의 몫은 배정만큼이다
        entry.pickedQty += Math.min(row.qty, picked.get(`${row.shipmentLineId}|${row.sourceLocationId}`) ?? 0);
        entry.workItems.add(workItemId);
        byKey.set(key, entry);
      }
      const rows = [...byKey.values()]
        .map(({ workItems, ...row }) => ({ ...row, boxes: workItems.size }))
        .sort(
          (a, b) =>
            codepoint(a.locationCode, b.locationCode) || codepoint(a.skuCode, b.skuCode) || codepoint(a.skuId, b.skuId),
        );
      return { ...empty, boxes: boxes.size, rows };
    }, tx);
  }

  private async attributedPicks(trx: DbTx, batchId: string): Promise<Map<string, number>> {
    const [session] = await trx
      .select({ id: wmsTables.batchInventorySessions.id })
      .from(wmsTables.batchInventorySessions)
      .where(
        and(
          eq(wmsTables.batchInventorySessions.batchId, batchId),
          eq(wmsTables.batchInventorySessions.status, 'active'),
        ),
      )
      .limit(1);
    const picked = new Map<string, number>();
    if (!session) return picked;
    const rows = await trx
      .select({
        shipmentLineId: wmsTables.batchInventorySessionBalances.shipmentLineId,
        sourceLocationId: wmsTables.batchInventorySessionBalances.sourceLocationId,
        qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int`,
      })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
          inArray(wmsTables.batchInventorySessionBalances.custodyType, [...LINE_ATTRIBUTED_CUSTODY_TYPES]),
        ),
      )
      .groupBy(
        wmsTables.batchInventorySessionBalances.shipmentLineId,
        wmsTables.batchInventorySessionBalances.sourceLocationId,
      )
      .orderBy(asc(wmsTables.batchInventorySessionBalances.shipmentLineId));
    for (const row of rows) {
      if (row.shipmentLineId && row.sourceLocationId)
        picked.set(`${row.shipmentLineId}|${row.sourceLocationId}`, Number(row.qty));
    }
    return picked;
  }
}
