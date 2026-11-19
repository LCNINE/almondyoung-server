/**
 * 상자가 기다리는 취소 — 배치에서 피킹 중인 상자를 부분 취소하면 취소 오퍼레이션이 대기(pending)로 남고,
 * 현장에서 상자가 빠져야 이어진다. 화면들이 «무엇을 몇 개 취소하려고 기다리는지»를 같은 판정으로 보이게 한다.
 */
import { and, asc, eq, getTableName, inArray, sql, type Column, type SQL, type Table } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';

type ReadDb = DbTx | DbService<typeof wmsSchema>['db'];

export interface PendingCancellationLine {
  shipmentLineId: string;
  /** 이 줄에서 취소될 수량 */
  qty: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 대기 중인 취소 오퍼레이션 스냅샷의 줄별 취소 수량. 모양이 어긋나면 null — 조회는 막지 않는다. */
export function readPendingCancellationLines(snapshot: unknown): PendingCancellationLine[] | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.pendingIntent)) return null;
  const intent = snapshot.pendingIntent;
  if (intent.kind !== 'cancel_outstanding' || !Array.isArray(intent.lines) || intent.lines.length === 0) return null;
  const lines: PendingCancellationLine[] = [];
  for (const line of intent.lines) {
    if (!isRecord(line) || typeof line.shipmentLineId !== 'string') return null;
    if (typeof line.qty !== 'number' || !Number.isSafeInteger(line.qty) || line.qty <= 0) return null;
    lines.push({ shipmentLineId: line.shipmentLineId, qty: line.qty });
  }
  return lines;
}

export interface PendingCancellationItem {
  shipmentLineId: string;
  salesOrderLineId: string | null;
  skuName: string;
  qty: number;
}

export interface PendingCancellation {
  operationId: string;
  lines: PendingCancellationItem[];
}

/** 상자마다 가장 먼저 접수된 대기 취소. 스냅샷 모양이 어긋난 상자는 빠진다 — 조회는 막지 않는다. */
export async function loadPendingCancellations(
  trx: ReadDb,
  shipmentIds: readonly string[],
): Promise<Map<string, PendingCancellation>> {
  const result = new Map<string, PendingCancellation>();
  if (shipmentIds.length === 0) return result;
  const operations = await trx
    .select({
      shipmentId: wmsTables.shipmentOperationMembers.shipmentId,
      operationId: wmsTables.shipmentOperations.id,
      snapshot: wmsTables.shipmentOperations.afterManifestSnapshot,
    })
    .from(wmsTables.shipmentOperationMembers)
    .innerJoin(
      wmsTables.shipmentOperations,
      eq(wmsTables.shipmentOperations.id, wmsTables.shipmentOperationMembers.operationId),
    )
    .where(
      and(
        inArray(wmsTables.shipmentOperationMembers.shipmentId, [...shipmentIds]),
        eq(wmsTables.shipmentOperationMembers.role, 'source'),
        eq(wmsTables.shipmentOperations.type, 'cancel'),
        eq(wmsTables.shipmentOperations.status, 'pending'),
      ),
    )
    .orderBy(asc(wmsTables.shipmentOperations.createdAt), asc(wmsTables.shipmentOperations.id));

  const firstByShipment = new Map<string, { operationId: string; lines: { shipmentLineId: string; qty: number }[] }>();
  for (const operation of operations) {
    if (firstByShipment.has(operation.shipmentId)) continue;
    const lines = readPendingCancellationLines(operation.snapshot);
    if (lines) firstByShipment.set(operation.shipmentId, { operationId: operation.operationId, lines });
  }
  const lineIds = [...firstByShipment.values()].flatMap((pending) => pending.lines.map((line) => line.shipmentLineId));
  if (lineIds.length === 0) return result;

  const lineRows = await trx
    .select({
      id: wmsTables.shipmentLines.id,
      skuName: wmsTables.skus.name,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
    .leftJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(inArray(wmsTables.shipmentLines.id, lineIds));
  const lineById = new Map(lineRows.map((row) => [row.id, row]));

  for (const [shipmentId, pending] of firstByShipment) {
    result.set(shipmentId, {
      operationId: pending.operationId,
      lines: pending.lines.map((line) => {
        const row = lineById.get(line.shipmentLineId);
        return {
          shipmentLineId: line.shipmentLineId,
          salesOrderLineId: row?.salesOrderLineId ?? null,
          skuName: row?.skuName ?? '',
          qty: line.qty,
        };
      }),
    });
  }
  return result;
}

// 단일 테이블 select 에서 drizzle 은 컬럼의 테이블 한정자를 떼므로, 서브쿼리 안의 컬럼은 테이블 이름을 직접 적는다
const qualified = (table: Table, column: Column) =>
  sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;

/** 이 출고주문에 현장에서 빠지기를 기다리는 취소가 걸린 상자가 있는지 */
export function hasCancelWaitingBoxSql(): SQL<boolean> {
  const { shipments, shipmentLines, fulfillmentOrderItems, fulfillmentOrders } = wmsTables;
  return sql<boolean>`exists (
    select 1 from ${shipments}
    inner join ${shipmentLines} on ${qualified(shipmentLines, shipmentLines.shipmentId)} = ${qualified(shipments, shipments.id)}
    inner join ${fulfillmentOrderItems}
      on ${qualified(fulfillmentOrderItems, fulfillmentOrderItems.id)} = ${qualified(shipmentLines, shipmentLines.fulfillmentOrderItemId)}
    where ${qualified(fulfillmentOrderItems, fulfillmentOrderItems.fulfillmentOrderId)} = ${qualified(fulfillmentOrders, fulfillmentOrders.id)}
      and ${qualified(shipments, shipments.status)} = 'recovery_required'
      and ${qualified(shipments, shipments.recoveryCode)} = 'CANCEL_REPLAN_PENDING'
  )`;
}
