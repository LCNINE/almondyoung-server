/**
 * 물류앱에서 막힌 상자 — 출고 저장이 관리자 손이 필요한 사유로 거절된 기록 가운데 아직 풀리지 않은 것.
 * 기록은 지우지 않는다. 그 뒤 상자가 바뀌었거나(상태·작업 항목) 그 상자에 출고 저장이 반영됐으면 지난 일로 본다.
 * 바구니 배정 때문에 막힌 상자는 배정이 풀리면 지난 일이다.
 */
import { and, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ScanRejectionAction, scanRejectionReason } from '../scan-rejections/scan-rejection-reasons';
import { ACTIVE_WORK_ITEM_STATUSES } from '../services/work-item-status';

type ReadDb = DbTx | DbService<typeof wmsSchema>['db'];

/** 배치 상세 «넘기기» 명령 — 거절 뒤 이 명령이 끝났으면 관리자 할 일은 끝났다. */
const HANDOFF_COMMANDS = ['outbound_batch.work_item.picker.handoff', 'outbound_batch.work_item.packer.handoff'];

/** 거절을 남기는 출고 저장 명령 — 이 명령이 그 뒤 반영되면 막힘이 풀린 것이다. */
export const OUTBOUND_SAVE_COMMANDS = {
  'shipment.simple_outbound.scan': 'simple_scan',
  'shipment.simple_outbound.force': 'simple_force',
  'shipment.location_outbound.scan': 'location_scan',
  'shipment.location_outbound.force': 'location_force',
} as const;

export type OutboundSaveRoute = (typeof OUTBOUND_SAVE_COMMANDS)[keyof typeof OUTBOUND_SAVE_COMMANDS];

/** 막힌 상자가 작업을 이어 가는 작업 항목 상태 — 빼는 중(withdrawing)이면 관리자가 이미 손을 댄 것이다. */
const BLOCKING_WORK_ITEM_STATUSES: ReadonlySet<string> = new Set(
  ACTIVE_WORK_ITEM_STATUSES.filter((status) => status !== 'withdrawing'),
);

export interface OpenScanRejection {
  shipmentId: string;
  workItemId: string | null;
  code: string;
  reasonCode: string | null;
  message: string;
  action: ScanRejectionAction;
  route: OutboundSaveRoute;
  barcode: string | null;
  skuName: string | null;
  quantity: number | null;
  actorId: string;
  rejectedAt: Date;
  /** 거절 뒤 관리자가 담당을 넘겼으면 — 이제 받은 작업자가 다시 찍기만 남았다 */
  handedOff: { at: Date; workerId: string | null } | null;
}

const ROUTES: ReadonlyMap<string, OutboundSaveRoute> = new Map(Object.entries(OUTBOUND_SAVE_COMMANDS));

/**
 * 넘기기는 받은 쪽 담당 시각을 넘긴 시각과 같게 찍는다. 그 뒤 담당이 또 바뀌었으면(만료 뒤 다시 맡기 등)
 * 지금 담당자는 넘겨받은 사람이 아니므로 모른다고 둔다.
 */
function handedOffTo(
  item: {
    pickerId: string | null;
    pickerClaimedAt: Date | null;
    packerId: string | null;
    packerClaimedAt: Date | null;
  },
  at: Date,
): string | null {
  if (item.pickerClaimedAt?.getTime() === at.getTime()) return item.pickerId;
  if (item.packerClaimedAt?.getTime() === at.getTime()) return item.packerId;
  return null;
}

/** 상자마다 가장 최근 거절이 아직 풀리지 않았으면 싣는다. */
export async function loadOpenScanRejections(
  trx: ReadDb,
  shipmentIds: readonly string[],
): Promise<Map<string, OpenScanRejection>> {
  const result = new Map<string, OpenScanRejection>();
  const ids = [...new Set(shipmentIds)];
  if (ids.length === 0) return result;
  const t = wmsTables.outboundScanRejections;
  const rows = await trx
    .select({
      shipmentId: t.shipmentId,
      workItemId: t.workItemId,
      shipmentStatus: t.shipmentStatus,
      commandType: t.commandType,
      code: t.code,
      reasonCode: t.reasonCode,
      barcode: t.barcode,
      skuName: wmsTables.skus.name,
      quantity: t.quantity,
      actorId: t.actorId,
      createdAt: t.createdAt,
    })
    .from(t)
    .leftJoin(wmsTables.skus, eq(wmsTables.skus.id, t.skuId))
    .where(inArray(t.shipmentId, ids))
    .orderBy(desc(t.createdAt), desc(t.id));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.shipmentId)) latest.set(row.shipmentId, row);
  if (latest.size === 0) return result;

  const candidates = [...latest.keys()];
  const workItemIds = [...latest.values()].flatMap((row) => (row.workItemId ? [row.workItemId] : []));
  // 넘기기는 담당 사유로 막힌 상자에만 의미가 있다 — 그런 거절이 없으면 명령 기록을 읽지 않는다.
  const handoffWorkItemIds = [...latest.values()].flatMap((row) =>
    row.workItemId && scanRejectionReason(row.code).action === 'handoff_worker' ? [row.workItemId] : [],
  );
  const commands = wmsTables.fulfillmentCommandRequests;
  const workItems = workItemIds.length
    ? await trx
        .select({
          id: wmsTables.outboundBatchWorkItems.id,
          status: wmsTables.outboundBatchWorkItems.status,
          pickerId: wmsTables.outboundBatchWorkItems.pickerId,
          pickerClaimedAt: wmsTables.outboundBatchWorkItems.pickerClaimedAt,
          packerId: wmsTables.outboundBatchWorkItems.packerId,
          packerClaimedAt: wmsTables.outboundBatchWorkItems.packerClaimedAt,
          handedOffAt: wmsTables.outboundBatchWorkItems.handedOffAt,
        })
        .from(wmsTables.outboundBatchWorkItems)
        .where(inArray(wmsTables.outboundBatchWorkItems.id, workItemIds))
    : [];
  const [shipments, applied, totes] = await Promise.all([
    trx
      .select({ id: wmsTables.shipments.id, status: wmsTables.shipments.status })
      .from(wmsTables.shipments)
      .where(inArray(wmsTables.shipments.id, candidates)),
    trx
      .select({ shipmentId: commands.resourceId, lastAppliedAt: max(commands.completedAt) })
      .from(commands)
      .where(
        and(
          eq(commands.resourceType, 'shipment'),
          inArray(commands.resourceId, candidates),
          inArray(commands.commandType, [...ROUTES.keys()]),
          eq(commands.status, 'completed'),
          // 준비가 막혔거나 강제출고가 반영되지 않은 채 닫힌 명령은 반영된 것이 아니다.
          sql`coalesce(${commands.responseSnapshot}->>'outcome', '') not in ('preparation_blocked', 'rejected')`,
        ),
      )
      .groupBy(commands.resourceId),
    // 바구니 배정이 풀렸으면 바구니 때문에 막힌 상자는 이제 다시 찍을 수 있다.
    trx
      .selectDistinct({ shipmentId: wmsTables.shipmentToteAssignments.shipmentId })
      .from(wmsTables.shipmentToteAssignments)
      .where(
        and(
          inArray(wmsTables.shipmentToteAssignments.shipmentId, candidates),
          isNull(wmsTables.shipmentToteAssignments.releasedAt),
        ),
      ),
  ]);
  // 거절 시각과 같은 시계(앱)로 찍힌 명령 완료 시각으로 «거절 뒤에 넘겼는지»를 본다.
  const handoffs = handoffWorkItemIds.length
    ? await trx
        .select({ workItemId: commands.resourceId, lastHandedOffAt: max(commands.completedAt) })
        .from(commands)
        .where(
          and(
            eq(commands.resourceType, 'outbound_batch_work_item'),
            inArray(commands.resourceId, handoffWorkItemIds),
            inArray(commands.commandType, HANDOFF_COMMANDS),
            eq(commands.status, 'completed'),
          ),
        )
        .groupBy(commands.resourceId)
    : [];
  const statusOf = new Map(shipments.map((row) => [row.id, row.status]));
  const workItemOf = new Map(workItems.map((row) => [row.id, row]));
  const appliedAt = new Map(applied.map((row) => [row.shipmentId, row.lastAppliedAt]));
  const holdingTote = new Set(totes.map((row) => row.shipmentId));
  const handedOffAt = new Map(handoffs.map((row) => [row.workItemId, row.lastHandedOffAt]));

  for (const row of latest.values()) {
    const route = ROUTES.get(row.commandType);
    if (!route || statusOf.get(row.shipmentId) !== row.shipmentStatus) continue;
    const workItem = row.workItemId ? workItemOf.get(row.workItemId) : undefined;
    if (row.workItemId && (!workItem || !BLOCKING_WORK_ITEM_STATUSES.has(workItem.status))) continue;
    const last = appliedAt.get(row.shipmentId);
    if (last && last >= row.createdAt) continue;
    if (row.code === 'SHIPMENT_TOTE_NOT_RELEASED' && !holdingTote.has(row.shipmentId)) continue;
    const reason = scanRejectionReason(row.code);
    const handoffAt = row.workItemId ? handedOffAt.get(row.workItemId) : null;
    result.set(row.shipmentId, {
      shipmentId: row.shipmentId,
      workItemId: row.workItemId,
      code: row.code,
      reasonCode: row.reasonCode,
      message: reason.message,
      action: reason.action,
      route,
      barcode: row.barcode,
      skuName: row.skuName,
      quantity: row.quantity,
      actorId: row.actorId,
      rejectedAt: row.createdAt,
      handedOff:
        reason.action === 'handoff_worker' && workItem && handoffAt && handoffAt > row.createdAt
          ? { at: handoffAt, workerId: workItem.handedOffAt ? handedOffTo(workItem, workItem.handedOffAt) : null }
          : null,
    });
  }
  return result;
}
