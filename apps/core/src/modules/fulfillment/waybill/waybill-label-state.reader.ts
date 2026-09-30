import { Injectable, NotFoundException } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, desc, eq, notInArray } from 'drizzle-orm';
import { DbTx, inventorySchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CurrentLabelSummary, labelStateOf, LabelStateView } from './label/label-print-policy';
import { WaybillLabelContentAssembler } from './waybill-label-content.assembler';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';

const WI = wmsTables.outboundBatchWorkItems;

const WITHDRAWING: LabelStateView = { state: 'withdrawing', changes: [], issue: null };
const WITHDRAWN: LabelStateView = { state: 'withdrawn', changes: [], issue: null };

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
        .select({ status: WI.status, batchStartedAt: wmsTables.outboundBatches.startedAt })
        .from(WI)
        .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, WI.batchId))
        .where(and(eq(WI.shipmentId, shipmentId), notInArray(WI.status, ['completed', 'excluded'])))
        .limit(1);
      // 빠지는 박스에는 그릴 종이가 없다(I4) — 조립하지 않고 상태만.
      if (item?.status === 'withdrawing') return WITHDRAWING;
      if (item) return this.stateOf(trx, shipmentId, item.batchStartedAt !== null);
      // 활성 작업 항목이 없다 — 마지막이 시작된 배치에서 빠졌으면 withdrawn(시작 전 제외는 종이가 나간 적이 없다).
      const [last] = await trx
        .select({ status: WI.status, batchStartedAt: wmsTables.outboundBatches.startedAt })
        .from(WI)
        .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, WI.batchId))
        .where(eq(WI.shipmentId, shipmentId))
        .orderBy(desc(WI.createdAt), desc(WI.id))
        .limit(1);
      return last?.status === 'excluded' && last.batchStartedAt ? WITHDRAWN : null;
    }, tx);
  }

  async forBatch(
    batchId: string,
    tx?: DbTx,
  ): Promise<Array<{ shipmentId: string; workItemId: string } & LabelStateView>> {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select({ startedAt: wmsTables.outboundBatches.startedAt })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      const items = await trx
        .select({ id: WI.id, shipmentId: WI.shipmentId, status: WI.status })
        .from(WI)
        .where(and(eq(WI.batchId, batchId), notInArray(WI.status, ['completed', 'excluded'])))
        .orderBy(asc(WI.shipmentId));
      const views: Array<{ shipmentId: string; workItemId: string } & LabelStateView> = [];
      for (const item of items) {
        views.push({
          shipmentId: item.shipmentId,
          workItemId: item.id,
          ...(item.status === 'withdrawing'
            ? WITHDRAWING
            : await this.stateOf(trx, item.shipmentId, batch.startedAt !== null)),
        });
      }
      return views;
    }, tx);
  }

  private async stateOf(trx: DbTx, shipmentId: string, batchStarted: boolean): Promise<LabelStateView> {
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
    const prints = await this.prints.listByShipments(trx, [shipmentId]);
    return labelStateOf({ batchStarted, current, prints });
  }
}
