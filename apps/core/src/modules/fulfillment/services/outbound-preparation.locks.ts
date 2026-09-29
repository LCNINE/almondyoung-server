import { and, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { lockAggregate } from '../picking/allocation/allocation.locks';
import { conflict } from '../picking/allocation/allocation.errors';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';

/** 잠금 없는 읽기. 시작은 한 번만 일어나므로(`startedAt` 단조) 읽은 값이 뒤집히지 않는다. */
export async function isBatchStarted(batchId: string, tx: DbTx): Promise<boolean> {
  const [batch] = await tx
    .select({ startedAt: wmsTables.outboundBatches.startedAt })
    .from(wmsTables.outboundBatches)
    .where(eq(wmsTables.outboundBatches.id, batchId))
    .limit(1);
  return Boolean(batch?.startedAt);
}

/**
 * Called under the active work-item lock, before downstream work -> session guards.
 * Do not introduce a session lock here; the session is locked by the command that mutates it.
 */
export async function activePreparationSession(batchId: string, tx: DbTx): Promise<string | null> {
  const sessions = await tx
    .select()
    .from(wmsTables.batchInventorySessions)
    .where(
      and(
        eq(wmsTables.batchInventorySessions.batchId, batchId),
        inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
      ),
    );
  if (sessions.length !== 1 || sessions[0].status !== 'active') return null;
  return sessions[0].id;
}
