import { Injectable, NotFoundException } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, desc, eq, inArray, isNotNull, ne, notInArray } from 'drizzle-orm';
import { DbTx, inventorySchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CurrentLabelSummary, labelStateOf, LabelStateView } from './label/label-print-policy';
import { WaybillLabelContentAssembler } from './waybill-label-content.assembler';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';
import { maskName, readRecipientName } from '../reader/recipient-snapshot';
import { WAYBILL_TERMINAL_STATUSES } from './waybill.constants';

const WI = wmsTables.outboundBatchWorkItems;

const WITHDRAWING: LabelStateView = { state: 'withdrawing', changes: [], issue: null };

/** 배치 현황(스테이션 F2) 박스 한 줄 — 송장 상태에 현장이 읽을 값을 붙인다 */
export type BatchBoxLabelState = LabelStateView & {
  shipmentId: string;
  workItemId: string;
  /** 작업 항목 상태 — «대기·검수 중·빠지는 중» */
  workItemStatus: string;
  /** 지금 쓰는 송장 번호(무효·종결 송장 제외). 없으면 null */
  trackingNo: string | null;
  recipientMasked: string;
};

/**
 * 송장 상태(스펙 §10.5) — 조회 전용. 몇 번을 어느 PC 에서 불러도 같은 결과이고 아무것도 바꾸지 않는다.
 * 조립이 도메인 거절(ConflictError)로 실패하면 `unavailable` 로 보고한다 — 송장 스캔 자체를 실패시키지 않는다.
 */
@Injectable()
export class WaybillLabelStateReader {
  constructor(
    private readonly assembler: WaybillLabelContentAssembler,
    private readonly prints: WaybillLabelPrintRepository,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
  ) {}

  async forShipment(shipmentId: string, tx?: DbTx): Promise<LabelStateView | null> {
    return this.dbService.run(async (trx) => {
      const [item] = await trx
        .select({
          id: WI.id,
          status: WI.status,
          createdAt: WI.createdAt,
          batchStartedAt: wmsTables.outboundBatches.startedAt,
        })
        .from(WI)
        .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, WI.batchId))
        .where(and(eq(WI.shipmentId, shipmentId), notInArray(WI.status, ['completed', 'excluded'])))
        .limit(1);
      // 빠지는 박스에는 그릴 종이가 없다(I4) — 조립하지 않고 상태만.
      if (item?.status === 'withdrawing') return WITHDRAWING;
      if (item) {
        return this.stateOf(
          trx,
          shipmentId,
          item.batchStartedAt !== null,
          await this.discardedPaperCutoff(trx, shipmentId, item),
        );
      }
      // 활성 작업 항목이 없다 — 마지막이 시작된 배치에서 빠졌으면 withdrawn(시작 전 제외는 종이가 나간 적이 없다).
      const [last] = await trx
        .select({
          status: WI.status,
          exitTo: WI.exitTo,
          batchStartedAt: wmsTables.outboundBatches.startedAt,
        })
        .from(WI)
        .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, WI.batchId))
        .where(eq(WI.shipmentId, shipmentId))
        .orderBy(desc(WI.createdAt), desc(WI.id))
        .limit(1);
      return last?.status === 'excluded' && last.batchStartedAt
        ? { state: 'withdrawn', changes: [], issue: null, exitTo: last.exitTo }
        : null;
    }, tx);
  }

  async forBatch(batchId: string, tx?: DbTx): Promise<BatchBoxLabelState[]> {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select({ startedAt: wmsTables.outboundBatches.startedAt })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      const items = await trx
        .select({ id: WI.id, shipmentId: WI.shipmentId, status: WI.status, createdAt: WI.createdAt })
        .from(WI)
        .where(and(eq(WI.batchId, batchId), notInArray(WI.status, ['completed', 'excluded'])))
        .orderBy(asc(WI.shipmentId));
      const shipmentIds = items.map((item) => item.shipmentId);
      const trackingNos = await this.trackingNosOf(trx, shipmentIds);
      const recipients = await this.recipientsOf(trx, shipmentIds);
      const views: BatchBoxLabelState[] = [];
      for (const item of items) {
        views.push({
          shipmentId: item.shipmentId,
          workItemId: item.id,
          workItemStatus: item.status,
          trackingNo: trackingNos.get(item.shipmentId) ?? null,
          recipientMasked: recipients.get(item.shipmentId) ?? '',
          ...(item.status === 'withdrawing'
            ? WITHDRAWING
            : await this.stateOf(
                trx,
                item.shipmentId,
                batch.startedAt !== null,
                await this.discardedPaperCutoff(trx, item.shipmentId, item),
              )),
        });
      }
      return views;
    }, tx);
  }

  /** 박스마다 지금 쓰는 송장 번호 — 송장 스캔 조회(`ShipmentWaybillReader.byTrackingNo`)와 같은 기준(종결 송장 제외). */
  private async trackingNosOf(trx: DbTx, shipmentIds: string[]): Promise<Map<string, string>> {
    if (shipmentIds.length === 0) return new Map();
    const rows = await trx
      .select({ shipmentId: wmsTables.waybills.shipmentId, trackingNo: wmsTables.waybills.trackingNo })
      .from(wmsTables.waybills)
      .where(
        and(
          inArray(wmsTables.waybills.shipmentId, shipmentIds),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      );
    const byShipment = new Map<string, string>();
    for (const row of rows) {
      if (row.trackingNo && !byShipment.has(row.shipmentId)) byShipment.set(row.shipmentId, row.trackingNo);
    }
    return byShipment;
  }

  private async recipientsOf(trx: DbTx, shipmentIds: string[]): Promise<Map<string, string>> {
    if (shipmentIds.length === 0) return new Map();
    const rows = await trx
      .select({ id: wmsTables.shipments.id, snapshot: wmsTables.shipments.recipientSnapshot })
      .from(wmsTables.shipments)
      .where(inArray(wmsTables.shipments.id, shipmentIds));
    return new Map(rows.map((row) => [row.id, maskName(readRecipientName(row.snapshot))]));
  }

  /**
   * 시작된 배치에서 빠졌던 박스가 다시 계획돼 들어왔으면, 그 전에 찍은 종이는 작업자가 버린 것이다 — 그 이후(현재 작업 항목
   * 생성 시각부터)의 출력만 센다. 빠진 적이 없으면 undefined(전부 센다).
   */
  private async discardedPaperCutoff(
    trx: DbTx,
    shipmentId: string,
    active: { id: string; createdAt: Date },
  ): Promise<Date | undefined> {
    const [earlier] = await trx
      .select({ id: WI.id })
      .from(WI)
      .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, WI.batchId))
      .where(
        and(
          eq(WI.shipmentId, shipmentId),
          ne(WI.id, active.id),
          eq(WI.status, 'excluded'),
          isNotNull(wmsTables.outboundBatches.startedAt),
        ),
      )
      .limit(1);
    return earlier ? active.createdAt : undefined;
  }

  private async stateOf(
    trx: DbTx,
    shipmentId: string,
    batchStarted: boolean,
    printsSince?: Date,
  ): Promise<LabelStateView> {
    if (!batchStarted) return labelStateOf({ batchStarted, current: { kind: 'external' }, prints: [] });
    let current: CurrentLabelSummary;
    try {
      const label = await this.assembler.current(shipmentId, trx);
      current =
        label.kind === 'external'
          ? { kind: 'external' }
          : { kind: 'printable', fingerprint: label.fingerprint, items: label.content.items };
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      current = { kind: 'unavailable', issue: /^([A-Z][A-Z_]+):/.exec(error.message)?.[1] ?? 'CONFLICT' };
    }
    const all = await this.prints.listByShipments(trx, [shipmentId]);
    const prints = printsSince ? all.filter((p) => p.printedAt >= printsSince) : all;
    return labelStateOf({ batchStarted, current, prints });
  }
}
