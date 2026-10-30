import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, desc, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ConsolidationProgressResponseDto } from '../dto/consolidation.dto';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { buildConsolidationProgressResponse, consolidationProgressSourceIds } from './consolidation-progress';
import { ConsolidationService } from './consolidation.service';

const RESUME_RULE = 'resume-pending-consolidation';

@Injectable()
export class ConsolidationProgressReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly consolidation: ConsolidationService,
  ) {}

  /** 이 상자가 원본인 가장 최근 합포장의 진행. 없으면 null */
  async findForShipment(shipmentId: string, tx?: DbTx): Promise<ConsolidationProgressResponseDto | null> {
    return this.dbService.run(async (trx) => {
      const operation = await this.latestOperation(trx, shipmentId);

      if (!operation) return null;

      const members = await trx
        .select({
          shipmentId: wmsTables.shipmentOperationMembers.shipmentId,
          role: wmsTables.shipmentOperationMembers.role,
        })
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.operationId, operation.id));
      const sourceIds = consolidationProgressSourceIds(members);
      const blockers =
        operation.status === 'pending'
          ? ((await this.consolidation.resumeReadiness(operation.id, trx))?.blockers ?? [])
          : [];
      const [workItems, waybills, reconcileStates] = await Promise.all([
        trx
          .select({
            shipmentId: wmsTables.outboundBatchWorkItems.shipmentId,
            batchId: wmsTables.outboundBatchWorkItems.batchId,
            status: wmsTables.outboundBatchWorkItems.status,
          })
          .from(wmsTables.outboundBatchWorkItems)
          .where(
            and(
              inArray(wmsTables.outboundBatchWorkItems.shipmentId, sourceIds),
              ne(wmsTables.outboundBatchWorkItems.status, 'excluded'),
            ),
          )
          .orderBy(desc(wmsTables.outboundBatchWorkItems.createdAt)),
        trx
          .select({
            shipmentId: wmsTables.waybills.shipmentId,
            id: wmsTables.waybills.id,
            status: wmsTables.waybills.status,
            trackingNo: wmsTables.waybills.trackingNo,
          })
          .from(wmsTables.waybills)
          .where(
            and(
              inArray(wmsTables.waybills.shipmentId, sourceIds),
              notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
            ),
          )
          .orderBy(desc(wmsTables.waybills.createdAt)),
        trx
          .select({
            shipmentId: wmsTables.shipmentReconcileState.shipmentId,
            gaveUpAt: wmsTables.shipmentReconcileState.gaveUpAt,
            nextCheckAt: wmsTables.shipmentReconcileState.nextCheckAt,
          })
          .from(wmsTables.shipmentReconcileState)
          .where(
            and(
              eq(wmsTables.shipmentReconcileState.rule, RESUME_RULE),
              inArray(wmsTables.shipmentReconcileState.shipmentId, sourceIds),
            ),
          ),
      ]);

      return buildConsolidationProgressResponse({
        operation,
        members,
        blockers,
        workItems,
        waybills,
        reconcileStates,
      });
    }, tx);
  }

  // 상태로 거르지 않는다. 최근 작업이 실패했는데 더 오래된 완료 작업을 돌려주면 화면이 엉뚱한 새 상자로 안내한다
  private async latestOperation(tx: DbTx, shipmentId: string) {
    const [row] = await tx
      .select({ id: wmsTables.shipmentOperations.id, status: wmsTables.shipmentOperations.status })
      .from(wmsTables.shipmentOperationMembers)
      .innerJoin(
        wmsTables.shipmentOperations,
        eq(wmsTables.shipmentOperations.id, wmsTables.shipmentOperationMembers.operationId),
      )
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
          eq(wmsTables.shipmentOperations.type, 'consolidate'),
        ),
      )
      .orderBy(desc(wmsTables.shipmentOperations.createdAt), desc(wmsTables.shipmentOperations.id))
      .limit(1);

    return row ?? null;
  }
}
