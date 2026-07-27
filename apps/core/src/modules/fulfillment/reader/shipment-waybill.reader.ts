import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, ne, notInArray, sql } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';

export interface ShipmentByWaybillLine {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
}

export interface ShipmentByWaybillResult {
  shipmentId: string;
  trackingNo: string;
  carrier: string;
  waybillStatus: string;
  shipmentStatus: string;
  batchId: string | null;
  workItemId: string | null;
  workItemStatus: string | null;
  recipientMasked: string;
  lines: ShipmentByWaybillLine[];
}

// `short_pick_recovery` 도 활성 상태다 — uq_outbound_work_item_active_shipment 는
// completed/excluded 만 제외한다. 열린 상태를 나열하면 이 예외 상태가 "작업 없음" 으로
// 조용히 보고된다. DB 자신의 "활성" 정의(종결 2개만 제외)를 그대로 따른다.
const TERMINAL_WORK_ITEM_STATUSES = ['completed', 'excluded'] as const;

/** 이름은 뒤 절반을 가린다 — 현장 화면에 개인정보를 통째로 띄우지 않는다. */
function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  const keep = Math.ceil(trimmed.length / 2);
  return `${trimmed.slice(0, keep)}${'*'.repeat(trimmed.length - keep)}`;
}

function isRecipientRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** jsonb 스냅샷에서 이름만 안전하게 뽑는다 — `as` 캐스팅 없이 좁힌다. */
function readRecipientName(snapshot: unknown): string {
  if (!isRecipientRecord(snapshot)) return '';
  const { recipientName } = snapshot;
  return typeof recipientName === 'string' ? recipientName : '';
}

@Injectable()
export class ShipmentWaybillReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async byTrackingNo(trackingNo: string): Promise<ShipmentByWaybillResult> {
    const normalized = trackingNo.trim();
    return this.dbService.run(async (trx) => {
      const [waybill] = await trx
        .select({
          shipmentId: wmsTables.waybills.shipmentId,
          trackingNo: wmsTables.waybills.trackingNo,
          carrier: wmsTables.waybills.carrier,
          status: wmsTables.waybills.status,
        })
        .from(wmsTables.waybills)
        .where(
          and(
            eq(wmsTables.waybills.trackingNo, normalized),
            notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
          ),
        )
        .limit(1);
      if (!waybill) throw new NotFoundException(`Waybill not found for tracking number ${normalized}`);

      const [shipment] = await trx
        .select({ status: wmsTables.shipments.status, recipientSnapshot: wmsTables.shipments.recipientSnapshot })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, waybill.shipmentId))
        .limit(1);
      if (!shipment) throw new NotFoundException(`Shipment ${waybill.shipmentId} not found`);

      const [workItem] = await trx
        .select({
          id: wmsTables.outboundBatchWorkItems.id,
          batchId: wmsTables.outboundBatchWorkItems.batchId,
          status: wmsTables.outboundBatchWorkItems.status,
        })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.shipmentId, waybill.shipmentId),
            notInArray(wmsTables.outboundBatchWorkItems.status, [...TERMINAL_WORK_ITEM_STATUSES]),
          ),
        )
        .limit(1);

      const lines = await trx
        .select({
          shipmentLineId: wmsTables.shipmentLines.id,
          skuId: wmsTables.shipmentLines.skuId,
          skuCode: wmsTables.skus.code,
          skuName: wmsTables.skus.name,
          qty: wmsTables.shipmentLines.qty,
          inspectedQty: wmsTables.shipmentLines.inspectedQty,
        })
        .from(wmsTables.shipmentLines)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
        .where(eq(wmsTables.shipmentLines.shipmentId, waybill.shipmentId))
        .orderBy(asc(wmsTables.shipmentLines.id));

      // 배치의 active session 위에서 SETTLED 를 제외한 커스터디 합계 — 박스를
      // 내려놨다가 다시 스캔하는 재개 흐름을 위해 SimpleOutboundService.pickedQtyForLine
      // 과 같은 집계를 여기서도 낸다. work item 이 없거나 active session 이 없으면
      // (아직 피킹을 시작 안 함) 모든 라인이 0 이다.
      const pickedByLine = new Map<string, number>();
      if (workItem) {
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
        if (session) {
          const balances = await trx
            .select({
              shipmentLineId: wmsTables.batchInventorySessionBalances.shipmentLineId,
              qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int`,
            })
            .from(wmsTables.batchInventorySessionBalances)
            .where(
              and(
                eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
                ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
              ),
            )
            .groupBy(wmsTables.batchInventorySessionBalances.shipmentLineId);
          for (const balance of balances) {
            if (balance.shipmentLineId) pickedByLine.set(balance.shipmentLineId, Number(balance.qty));
          }
        }
      }

      return {
        shipmentId: waybill.shipmentId,
        trackingNo: waybill.trackingNo ?? normalized,
        carrier: waybill.carrier,
        waybillStatus: waybill.status,
        shipmentStatus: shipment.status,
        batchId: workItem?.batchId ?? null,
        workItemId: workItem?.id ?? null,
        workItemStatus: workItem?.status ?? null,
        recipientMasked: maskName(readRecipientName(shipment.recipientSnapshot)),
        lines: lines.map((line) => ({ ...line, pickedQty: pickedByLine.get(line.shipmentLineId) ?? 0 })),
      };
    });
  }
}
