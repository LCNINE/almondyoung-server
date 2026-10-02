import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, desc, eq, ne, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { WaybillLabelStateReader } from '../waybill/waybill-label-state.reader';
import type { LabelItemChange, LabelState } from '../waybill/label/label-print-policy';
import { loadWithdrawalRemovals, WithdrawalRemoval } from '../services/withdrawal-removals.query';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { maskName, readDeliveryNote, readRecipientName } from './recipient-snapshot';

// 보충 대기·배치 오케스트레이터·스펙이 이 경로로 가져다 쓴다 — 정본을 옮긴 뒤에도 그대로 둔다
export { maskName, readDeliveryNote, readRecipientName } from './recipient-snapshot';

export interface ShipmentByWaybillAllocation {
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

export interface ShipmentByWaybillLine {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
  lineVersion: number;
  /** 송장 순서(로케이션 코드 순). 시작 안 된 배치·작업 항목 없음이면 [] */
  allocations: ShipmentByWaybillAllocation[];
}

export interface ShortPickContext {
  workItemLeaseVersion: number;
  sessionId: string;
  sessionVersion: number;
  manifestVersion: number;
}

export interface ShipmentByWaybillResult {
  warehouseId: string;
  shipmentId: string;
  trackingNo: string;
  carrier: string;
  waybillStatus: string;
  shipmentStatus: string;
  batchId: string | null;
  workItemId: string | null;
  workItemStatus: string | null;
  recipientMasked: string;
  deliveryNote: string | null;
  lines: ShipmentByWaybillLine[];
  /** 송장 상태(스펙 §10.5). 활성 작업 항목이 없으면 null — 시작된 배치에서 빠진 박스(withdrawn)만 예외. */
  labelState: LabelState | null;
  /** reprint_required 일 때 마지막 출력과 현재 품목 줄의 차이. */
  labelChanges: LabelItemChange[];
  /** unavailable 의 사유 코드. */
  labelIssue: string | null;
  /** 이탈 중이면 뺄 목록(스펙 §10.5 withdrawing). 그 밖엔 []. */
  removals: WithdrawalRemoval[];
  /** withdrawing 이면 활성 작업 항목의 exit_to, withdrawn 이면 마지막 작업 항목의 exit_to. 그 밖엔 null. */
  exitTo: 'draft' | 'canceled' | null;
  /** 결품 보고(POST shipments/:id/short-picks)에 필요한 버전. 활성 작업 항목과 active 세션이 둘 다 있을 때만 */
  shortPickContext: ShortPickContext | null;
}

// `short_pick_recovery` 도 활성 상태다 — uq_outbound_work_item_active_shipment 는
// completed/excluded 만 제외한다. 열린 상태를 나열하면 이 예외 상태가 "작업 없음" 으로
// 조용히 보고된다. DB 자신의 "활성" 정의(종결 2개만 제외)를 그대로 따른다.
const TERMINAL_WORK_ITEM_STATUSES = ['completed', 'excluded'] as const;

@Injectable()
export class ShipmentWaybillReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly labelStates: WaybillLabelStateReader,
  ) {}

  async byTrackingNo(trackingNo: string, warehouseId?: string): Promise<ShipmentByWaybillResult> {
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
      if (!waybill) {
        const withdrawn = await this.withdrawnByVoidedWaybill(trx, normalized, warehouseId);
        if (withdrawn) return withdrawn;
        throw new NotFoundException(`Waybill not found for tracking number ${normalized}`);
      }

      const [shipment] = await trx
        .select({
          warehouseId: wmsTables.shipments.warehouseId,
          status: wmsTables.shipments.status,
          recipientSnapshot: wmsTables.shipments.recipientSnapshot,
          manifestVersion: wmsTables.shipments.manifestVersion,
        })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, waybill.shipmentId))
        .limit(1);
      if (!shipment) throw new NotFoundException(`Shipment ${waybill.shipmentId} not found`);

      if (warehouseId !== undefined && warehouseId !== shipment.warehouseId) {
        throw new ConflictException({
          code: 'LOCATION_OUTBOUND_WAREHOUSE_MISMATCH',
          error: 'LOCATION_OUTBOUND_WAREHOUSE_MISMATCH',
          message: 'Shipment belongs to another warehouse',
        });
      }

      const [workItem] = await trx
        .select({
          id: wmsTables.outboundBatchWorkItems.id,
          batchId: wmsTables.outboundBatchWorkItems.batchId,
          status: wmsTables.outboundBatchWorkItems.status,
          exitTo: wmsTables.outboundBatchWorkItems.exitTo,
          leaseVersion: wmsTables.outboundBatchWorkItems.leaseVersion,
        })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.shipmentId, waybill.shipmentId),
            notInArray(wmsTables.outboundBatchWorkItems.status, [...TERMINAL_WORK_ITEM_STATUSES]),
          ),
        )
        .limit(1);

      const lines = await this.loadLines(trx, waybill.shipmentId);

      // 배치의 active session 위에서 SETTLED 를 제외한 커스터디 합계 — 박스를
      // 내려놨다가 다시 스캔하는 재개 흐름을 위해 SimpleOutboundService.pickedQtyForLine
      // 과 같은 집계를 여기서도 낸다. work item 이 없거나 active session 이 없으면
      // (아직 피킹을 시작 안 함) 모든 라인이 0 이다.
      const pickedByLine = new Map<string, number>();
      let activeSession: { id: string; version: number } | undefined;
      if (workItem) {
        const [session] = await trx
          .select({ id: wmsTables.batchInventorySessions.id, version: wmsTables.batchInventorySessions.version })
          .from(wmsTables.batchInventorySessions)
          .where(
            and(
              eq(wmsTables.batchInventorySessions.batchId, workItem.batchId),
              eq(wmsTables.batchInventorySessions.status, 'active'),
            ),
          )
          .limit(1);
        activeSession = session;
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

      const allocations = workItem
        ? await this.loadAllocations(trx, workItem.id)
        : new Map<string, ShipmentByWaybillAllocation[]>();

      const label = await this.labelStates.forShipment(waybill.shipmentId, trx);

      return {
        shipmentId: waybill.shipmentId,
        warehouseId: shipment.warehouseId,
        trackingNo: waybill.trackingNo ?? normalized,
        carrier: waybill.carrier,
        waybillStatus: waybill.status,
        shipmentStatus: shipment.status,
        batchId: workItem?.batchId ?? null,
        workItemId: workItem?.id ?? null,
        workItemStatus: workItem?.status ?? null,
        recipientMasked: maskName(readRecipientName(shipment.recipientSnapshot)),
        deliveryNote: readDeliveryNote(shipment.recipientSnapshot),
        lines: lines.map((line) => ({
          ...line,
          pickedQty: pickedByLine.get(line.shipmentLineId) ?? 0,
          allocations: allocations.get(line.shipmentLineId) ?? [],
        })),
        labelState: label?.state ?? null,
        labelChanges: label?.changes ?? [],
        labelIssue: label?.issue ?? null,
        removals: workItem?.status === 'withdrawing' ? await loadWithdrawalRemovals(trx, workItem.id) : [],
        exitTo:
          workItem?.status === 'withdrawing'
            ? workItem.exitTo
            : label?.state === 'withdrawn'
              ? (label.exitTo ?? null)
              : null,
        shortPickContext:
          workItem && activeSession
            ? {
                workItemLeaseVersion: workItem.leaseVersion,
                sessionId: activeSession.id,
                sessionVersion: activeSession.version,
                manifestVersion: shipment.manifestVersion,
              }
            : null,
      };
    });
  }

  /** 작업 항목의 배정 — 송장 품목 줄과 같은 순서(로케이션 코드 순). 수량 0 행은 송장에 없으므로 뺀다. */
  private async loadAllocations(trx: DbTx, workItemId: string): Promise<Map<string, ShipmentByWaybillAllocation[]>> {
    const rows = await trx
      .select({
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        locationCode: wmsTables.locations.code,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.pickingSourceAllocations.sourceLocationId))
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId))
      .orderBy(
        asc(sql`${wmsTables.locations.code} collate "C"`),
        asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      );
    const byLine = new Map<string, ShipmentByWaybillAllocation[]>();
    for (const row of rows) {
      if (row.qty <= 0) continue;
      const list = byLine.get(row.shipmentLineId) ?? [];
      list.push({ sourceLocationId: row.sourceLocationId, locationCode: row.locationCode, qty: row.qty });
      byLine.set(row.shipmentLineId, list);
    }
    return byLine;
  }

  private loadLines(trx: DbTx, shipmentId: string) {
    return trx
      .select({
        shipmentLineId: wmsTables.shipmentLines.id,
        skuId: wmsTables.shipmentLines.skuId,
        skuCode: wmsTables.skus.code,
        skuName: wmsTables.skus.name,
        qty: wmsTables.shipmentLines.qty,
        inspectedQty: wmsTables.shipmentLines.inspectedQty,
        lineVersion: wmsTables.shipmentLines.lineVersion,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
  }

  /**
   * 전체 취소·결품으로 나간 박스는 송장이 무효라 활성 송장으로는 못 찾는다(정한 것 4). 작업자가 든 종이를 다시 스캔하면 «빠진 박스 · 송장은
   * 버리세요» 를 보여야 한다(스펙 §10.5 withdrawn, 정한 것 13) — 그 번호의 가장 최근 무효 송장으로 박스를 찾는다.
   */
  private async withdrawnByVoidedWaybill(
    trx: DbTx,
    trackingNo: string,
    warehouseId?: string,
  ): Promise<ShipmentByWaybillResult | null> {
    const [waybill] = await trx
      .select({
        id: wmsTables.waybills.id,
        shipmentId: wmsTables.waybills.shipmentId,
        trackingNo: wmsTables.waybills.trackingNo,
        carrier: wmsTables.waybills.carrier,
        status: wmsTables.waybills.status,
      })
      .from(wmsTables.waybills)
      .where(and(eq(wmsTables.waybills.trackingNo, trackingNo), eq(wmsTables.waybills.status, 'voided')))
      .orderBy(
        sql`${wmsTables.waybills.voidedAt} desc nulls last`,
        desc(wmsTables.waybills.createdAt),
        desc(wmsTables.waybills.id),
      )
      .limit(1);
    if (!waybill) return null;
    const [shipment] = await trx
      .select({
        warehouseId: wmsTables.shipments.warehouseId,
        status: wmsTables.shipments.status,
        recipientSnapshot: wmsTables.shipments.recipientSnapshot,
      })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, waybill.shipmentId))
      .limit(1);
    if (!shipment) return null;
    if (warehouseId !== undefined && warehouseId !== shipment.warehouseId) return null;
    // 결품으로 빠진 초안 박스가 나중에 초안으로 취소되면 status 는 canceled 지만 이 송장은 결품이 무효화한 것이다 — 취소 이탈이 아니면 결품 이탈도 본다.
    const exitTo =
      (shipment.status === 'canceled' ? await this.canceledExit(trx, waybill.shipmentId) : null) ??
      (await this.shortPickExit(trx, waybill.shipmentId, waybill.id));
    if (!exitTo) return null;
    const lines = await this.loadLines(trx, waybill.shipmentId);
    return {
      shipmentId: waybill.shipmentId,
      warehouseId: shipment.warehouseId,
      trackingNo: waybill.trackingNo ?? trackingNo,
      carrier: waybill.carrier,
      waybillStatus: waybill.status,
      shipmentStatus: shipment.status,
      batchId: null,
      workItemId: null,
      workItemStatus: null,
      recipientMasked: maskName(readRecipientName(shipment.recipientSnapshot)),
      deliveryNote: readDeliveryNote(shipment.recipientSnapshot),
      lines: lines.map((line) => ({ ...line, pickedQty: 0, allocations: [] })),
      labelState: 'withdrawn',
      labelChanges: [],
      labelIssue: null,
      removals: [],
      exitTo,
      shortPickContext: null,
    };
  }

  /** PR 3 — 마지막 작업 항목이 취소로 나갔다. */
  private async canceledExit(trx: DbTx, shipmentId: string): Promise<'canceled' | null> {
    const [last] = await trx
      .select({ status: wmsTables.outboundBatchWorkItems.status, exitTo: wmsTables.outboundBatchWorkItems.exitTo })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId))
      .orderBy(desc(wmsTables.outboundBatchWorkItems.createdAt), desc(wmsTables.outboundBatchWorkItems.id))
      .limit(1);
    return last?.status === 'excluded' && last.exitTo === 'canceled' ? 'canceled' : null;
  }

  /** PR 4 — 이 송장을 결품 마무리가 무효화했다(ShortPickExitService.finish 가 after 스냅샷에 적는다). 박스가 다시 계획돼도 옛 번호는 그대로 빠진 박스다. */
  private async shortPickExit(trx: DbTx, shipmentId: string, waybillId: string): Promise<'draft' | null> {
    const [operation] = await trx
      .select({ id: wmsTables.shipmentOperations.id })
      .from(wmsTables.shipmentOperations)
      .innerJoin(
        wmsTables.shipmentOperationMembers,
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
        ),
      )
      .where(
        and(
          eq(wmsTables.shipmentOperations.type, 'short_pick'),
          eq(wmsTables.shipmentOperations.status, 'completed'),
          sql`${wmsTables.shipmentOperations.afterManifestSnapshot}->>'voidedWaybillId' = ${waybillId}`,
        ),
      )
      .limit(1);
    return operation ? 'draft' : null;
  }
}
