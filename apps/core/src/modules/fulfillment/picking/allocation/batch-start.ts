import { NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { PickingStrategyName } from '../picking-strategy.interface';
import { allocateLines } from './allocate-lines';
import { conflict } from './allocation.errors';
import { assertStartEligibility, lockAggregate, lockSourceCapacities } from './allocation.locks';
import {
  BatchStartDeps,
  BatchStartResult,
  SessionStartAllocation,
  UNSTARTED_BATCH_WORK_ITEM_STATUSES,
  uniqueSorted,
} from './allocation.types';

export interface StartBatchPickingInput {
  batchId: string;
  actorId: string;
  idempotencyKey: string;
}

/**
 * 배치 시작 = 시작 전 작업 항목(queued·picking) 전부를 한 트랜잭션에서 배정하고 재고 세션에 인계한다(ADR-0041).
 * 옛 «계획 초안 → 시작» 두 단계를 합친 것이다. 배정과 인계가 한 트랜잭션이라 초안이 낡을 틈이 없다.
 *
 * 이미 시작된 배치는 활성 세션을 그대로 돌려준다 — 단순출고는 박스마다 이 명령을 다른 키로 부른다.
 */
export async function startBatchPicking(
  deps: BatchStartDeps,
  strategyName: PickingStrategyName,
  input: StartBatchPickingInput,
  tx?: DbTx,
): Promise<BatchStartResult> {
  const commandType = `picking.${strategyName}.start`;
  deps.workflowGate.assertV2MutationAllowed(commandType);
  return deps.commands.execute<BatchStartResult>(
    {
      commandType,
      idempotencyKey: input.idempotencyKey,
      canonicalRequest: { strategy: strategyName, batchId: input.batchId, actorId: input.actorId },
    },
    async (trx, commandRequestId) => {
      const [batch] = await trx
        .select({
          id: wmsTables.outboundBatches.id,
          startedAt: wmsTables.outboundBatches.startedAt,
          status: wmsTables.outboundBatches.status,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${input.batchId} not found`);
      if (batch.startedAt) {
        const response = await existingStart(trx, input.batchId, commandRequestId);
        return { response, resourceType: 'batch_inventory_session', resourceId: response.sessionId };
      }
      assertBatchStartable(input.batchId, batch.status);

      const startable = await trx
        .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.batchId, input.batchId),
            inArray(wmsTables.outboundBatchWorkItems.status, [...UNSTARTED_BATCH_WORK_ITEM_STATUSES]),
          ),
        )
        .orderBy(asc(wmsTables.outboundBatchWorkItems.shipmentId));
      const shipmentIds = uniqueSorted(startable.map((row) => row.shipmentId));
      if (!shipmentIds.length) throw conflict('PICKING_BATCH_EMPTY', `Batch ${input.batchId} has no work to start`);

      const aggregate = await lockAggregate(trx, deps.invariant, input.batchId, shipmentIds);
      if (aggregate.batch.startedAt) {
        // 잠금을 기다리는 사이 다른 스캔이 시작했다 — 그 세션으로 합류한다.
        const response = await existingStart(trx, input.batchId, commandRequestId);
        return { response, resourceType: 'batch_inventory_session', resourceId: response.sessionId };
      }
      // 잠근 행으로 다시 본다 — 첫 조회와 잠금 사이에 배치가 완료·취소됐을 수 있다.
      assertBatchStartable(input.batchId, aggregate.batch.status);
      await assertNoOpenSession(trx, input.batchId);
      await assertStartEligibility(trx, deps.waybills, aggregate, shipmentIds);

      const workItemByShipment = new Map(aggregate.workItems.map((item) => [item.shipmentId, item.id]));
      const capacities = await lockSourceCapacities(trx, deps.controlledStock, aggregate);
      const drafts = allocateLines(
        aggregate.lines.map((line) => ({
          id: line.id,
          skuId: line.skuId,
          qty: line.qty,
          // holds because assertStartEligibility already proved the startable (queued·picking) work-item set equals
          // the requested shipment set, so every line's shipmentId has a matching work item.
          workItemId: workItemByShipment.get(line.shipmentId)!,
        })),
        capacities,
      );
      const inserted = await trx.insert(wmsTables.pickingSourceAllocations).values(drafts).returning();
      const skuByLine = new Map(aggregate.lines.map((line) => [line.id, line.skuId]));
      const allocations: SessionStartAllocation[] = inserted.map((row) => ({
        id: row.id,
        // holds because every inserted row came from `drafts`, built above with a non-null
        // workItemId for every line — the column is nullable in schema only for legacy rows.
        workItemId: row.workItemId!,
        shipmentLineId: row.shipmentLineId,
        // holds because skuByLine is built from the same aggregate.lines that produced `drafts`,
        // so every shipmentLineId returned from the insert has a matching entry.
        skuId: skuByLine.get(row.shipmentLineId)!,
        sourceLocationId: row.sourceLocationId,
        quantity: row.qty,
        sourceStockVersion: row.sourceStockVersion,
      }));
      const session = await deps.sessions.startSession(
        { batchId: input.batchId, actorId: input.actorId, allocations },
        trx,
      );
      const [marked] = await trx
        .update(wmsTables.outboundBatches)
        .set({ startedAt: sql`now()` })
        .where(and(eq(wmsTables.outboundBatches.id, input.batchId), isNull(wmsTables.outboundBatches.startedAt)))
        .returning({ id: wmsTables.outboundBatches.id });
      if (!marked) throw conflict('PICKING_BATCH_STALE', `Batch ${input.batchId} started concurrently`);
      const response: BatchStartResult = {
        state: 'started',
        operationId: commandRequestId,
        batchId: input.batchId,
        sessionId: session.id,
        status: session.status,
      };
      return { response, resourceType: 'batch_inventory_session', resourceId: session.id };
    },
    tx,
  );
}

/** 옛 `startSession` 이 막던 것과 같다 — 끝난 배치(completed·canceled)는 새로 시작하지 않는다. */
function assertBatchStartable(batchId: string, status: string): void {
  if (status === 'completed' || status === 'canceled') {
    throw conflict('OUTBOUND_BATCH_NOT_STARTABLE', `Outbound batch ${batchId} is ${status}`);
  }
}

/**
 * 시작 전(`started_at` NULL)인데 열린 세션이 있다 = 계획 흡수 전 코드가 연 세션이다(롤링 배포 중 옛 태스크가 시작한 배치).
 * 그대로 배정하면 옛 세션의 AT_SOURCE 가 가용을 깎아 SOURCE_INSUFFICIENT 재시도 고리에 빠지거나, 배정이 통과해
 * `startSession` 의 날 409(SESSION_ALREADY_STARTED)가 된다. 손상으로 내서 단순출고가 검토 차단 표지로 바꾸게 한다.
 *
 * 잠금 없이 읽는다: `lockAggregate` 의 불변식 검사가 이 배치의 세션 행을 이미 FOR UPDATE 로 잡았고(구성요소 →
 * 작업 항목 → 세션 순), 새 세션 삽입은 우리가 쥔 배치 행 잠금 뒤에서만 일어난다. 여기서 세션에 먼저 FOR UPDATE 를
 * 거는 일은 없으므로 잠금 순서가 바뀌지 않는다.
 */
async function assertNoOpenSession(trx: DbTx, batchId: string): Promise<void> {
  const [open] = await trx
    .select({ id: wmsTables.batchInventorySessions.id })
    .from(wmsTables.batchInventorySessions)
    .where(
      and(
        eq(wmsTables.batchInventorySessions.batchId, batchId),
        inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
      ),
    )
    .limit(1);
  if (open) {
    throw conflict('PICKING_BATCH_STATE_CORRUPT', `Unstarted batch ${batchId} already has an open inventory session`);
  }
}

async function existingStart(trx: DbTx, batchId: string, operationId: string): Promise<BatchStartResult> {
  const [session] = await trx
    .select({ id: wmsTables.batchInventorySessions.id, status: wmsTables.batchInventorySessions.status })
    .from(wmsTables.batchInventorySessions)
    .where(
      and(
        eq(wmsTables.batchInventorySessions.batchId, batchId),
        inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
      ),
    )
    .limit(1);
  if (!session) throw conflict('PICKING_BATCH_ALREADY_FINISHED', `Batch ${batchId} has no open inventory session`);
  return { state: 'started', operationId, batchId, sessionId: session.id, status: session.status };
}
