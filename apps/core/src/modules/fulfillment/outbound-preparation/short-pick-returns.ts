/**
 * 결품으로 배치에서 빠져 출고 준비로 돌아온 상자 — 돌아온 상자(`loadReturnedWorkItems`) 중 결품 이탈(exit_to=draft)로 끝났고,
 * 그 작업 항목을 내보낸 결품 오퍼레이션이 남긴 «상품·자리·모자란 수량»을 돌려준다.
 *
 * 연결은 순서가 아니라 기록이다: 오퍼레이션 의도의 `workItemId` 가 그 마지막 작업 항목이고 결과가 `exited` 인 것만 본다.
 * 같은 작업 항목에서 다시 채운(refilled) 결품은 상자를 내보내지 않았으므로 제외된다.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { shortPickOperationIntentOf } from '../services/batch-inventory-session.service';
import { BATCH_EXIT_REASONS, ReturnedWorkItem } from './batch-returns';

export interface ShortPickReturnLine {
  name: string;
  locationCode: string;
  shortQty: number;
}

function outcomeOf(snapshot: unknown): unknown {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>).outcome
    : undefined;
}

export async function loadShortPickReturns(
  trx: DbTx,
  returned: ReadonlyMap<string, ReturnedWorkItem>,
): Promise<Map<string, ShortPickReturnLine[]>> {
  const returns = new Map<string, ShortPickReturnLine[]>();
  const exitedWorkItem = new Map(
    [...returned]
      .filter(
        ([, item]) => item.exitTo === 'draft' && item.exclusionReason.startsWith(BATCH_EXIT_REASONS.shortPickPrefix),
      )
      .map(([shipmentId, item]) => [shipmentId, item.workItemId]),
  );

  if (exitedWorkItem.size === 0) {
    return returns;
  }

  const operations = await trx
    .select({
      shipmentId: wmsTables.shipmentOperationMembers.shipmentId,
      before: wmsTables.shipmentOperations.beforeManifestSnapshot,
      after: wmsTables.shipmentOperations.afterManifestSnapshot,
    })
    .from(wmsTables.shipmentOperations)
    .innerJoin(
      wmsTables.shipmentOperationMembers,
      eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
    )
    .where(
      and(
        inArray(wmsTables.shipmentOperationMembers.shipmentId, [...exitedWorkItem.keys()]),
        eq(wmsTables.shipmentOperations.type, 'short_pick'),
        eq(wmsTables.shipmentOperations.status, 'completed'),
        eq(wmsTables.shipmentOperationMembers.role, 'source'),
        inArray(sql<string>`${wmsTables.shipmentOperations.beforeManifestSnapshot} -> 'intent' ->> 'workItemId'`, [
          ...exitedWorkItem.values(),
        ]),
      ),
    );
  const shortages = new Map<string, Array<{ shipmentLineId: string; sourceLocationId: string; shortQty: number }>>();

  for (const operation of operations) {
    const intent = shortPickOperationIntentOf(operation.before);

    if (
      !intent ||
      intent.shipmentId !== operation.shipmentId ||
      intent.workItemId !== exitedWorkItem.get(operation.shipmentId) ||
      outcomeOf(operation.after) !== 'exited'
    ) {
      continue;
    }

    shortages.set(
      operation.shipmentId,
      intent.lines.filter((line) => line.shortQty > 0),
    );
  }

  const allLines = [...shortages.values()].flat();

  if (allLines.length === 0) {
    return returns;
  }

  const names = await trx
    .select({ id: wmsTables.shipmentLines.id, name: wmsTables.skus.name })
    .from(wmsTables.shipmentLines)
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
    .where(inArray(wmsTables.shipmentLines.id, [...new Set(allLines.map((line) => line.shipmentLineId))]));
  const codes = await trx
    .select({ id: wmsTables.locations.id, code: wmsTables.locations.code })
    .from(wmsTables.locations)
    .where(inArray(wmsTables.locations.id, [...new Set(allLines.map((line) => line.sourceLocationId))]));
  const nameById = new Map(names.map((row) => [row.id, row.name]));
  const codeById = new Map(codes.map((row) => [row.id, row.code]));

  for (const [shipmentId, lines] of shortages) {
    const resolved = lines.flatMap((line) => {
      const name = nameById.get(line.shipmentLineId);
      const locationCode = codeById.get(line.sourceLocationId);

      return name && locationCode ? [{ name, locationCode, shortQty: line.shortQty }] : [];
    });

    if (resolved.length > 0) {
      returns.set(shipmentId, resolved);
    }
  }

  return returns;
}
