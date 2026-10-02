import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, eq, notInArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { ReturnBinRemovalResponseDto } from '../dto/return-bin.dto';
import { BoxAllocationManager } from './box-allocation.manager';
import { BoxWithdrawalService, WorkItemRow } from './box-withdrawal.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { ReturnBinService } from './return-bin.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { resolveSkuIdByBarcode } from './sku-barcode-resolution';
import { loadWithdrawalRemovals } from './withdrawal-removals.query';

const WI = wmsTables.outboundBatchWorkItems;

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * 빼는 박스를 비우는 명령들(스펙 §8, 정한 것 1) — 박스에서 되돌림 바구니로. 토탈피킹 카트 여분(전략)도 나가기 정리를 여기 맡긴다.
 * 계획·오케스트레이터를 주입받는 쪽이 여기다(이탈 서비스는 그 둘을 모른다 — 순환 회피). 그래서 «canceled 로 나가면 취소 완료»,
 * «draft 로 나가면 대기 오퍼레이션 재개» 가 한 곳에 있다.
 */
@Injectable()
export class BoxReturnService {
  constructor(
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly withdrawals: BoxWithdrawalService,
    private readonly boxes: BoxAllocationManager,
    private readonly returnBins: ReturnBinService,
    private readonly barcodes: BarcodeService,
    private readonly planning: ShipmentPlanningService,
    private readonly batches: OutboundBatchOrchestrator,
  ) {}

  /** 잠금: 구성요소 → 작업 항목 → 세션 → 보관. 마지막 몫이면 같은 트랜잭션에서 나가고, canceled 면 취소까지 끝낸다. */
  async removeToReturnBin(
    shipmentId: string,
    input: { barcode: string; returnBinBarcode: string; quantity: number },
    actor: { id: string; roles: string[] },
    idempotencyKey: string,
    tx?: DbTx,
  ): Promise<ReturnBinRemovalResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.return_bin.remove');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    const barcode = input.barcode.trim();
    if (!barcode) throw new BadRequestException('barcode is required');
    const response = await this.commands.execute<ReturnBinRemovalResponseDto>(
      {
        commandType: 'shipment.return_bin.remove',
        idempotencyKey,
        canonicalRequest: {
          shipmentId,
          barcode,
          returnBinBarcode: input.returnBinBarcode.trim(),
          quantity: input.quantity,
          actorId: actor.id,
        },
      },
      async (trx, commandRequestId) => {
        await this.withdrawals.lockComponentsOf([shipmentId], trx);
        const [workItem] = await trx
          .select()
          .from(WI)
          .where(and(eq(WI.shipmentId, shipmentId), notInArray(WI.status, ['completed', 'excluded'])))
          .limit(1)
          .for('update');
        if (!workItem || workItem.status !== 'withdrawing') {
          throw conflict('SHIPMENT_NOT_WITHDRAWING', `Shipment ${shipmentId} is not leaving a batch`);
        }
        const [batch] = await trx
          .select({ warehouseId: wmsTables.outboundBatches.warehouseId })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, workItem.batchId))
          .limit(1);
        if (!batch) throw new Error(`Outbound batch ${workItem.batchId} referenced by a work item is missing`);
        const returnBin = await this.returnBins.requireActive(input.returnBinBarcode, batch.warehouseId, trx);
        const skuId = await resolveSkuIdByBarcode(this.barcodes, barcode, trx);
        if (!skuId) throw conflict('SIMPLE_OUTBOUND_BARCODE_UNKNOWN', 'Barcode does not resolve to a SKU');
        const session = await this.boxes.lockOpenSession(workItem.batchId, trx);
        if (!session || session.status !== 'active') {
          throw conflict(
            'PICKING_SESSION_NOT_ACTIVE',
            `Batch ${workItem.batchId} inventory session is ${session?.status ?? 'not open'}`,
          );
        }
        const removedQty = await this.boxes.removeFromBox(
          {
            session,
            workItemId: workItem.id,
            skuId,
            quantity: input.quantity,
            returnBin,
            actorId: actor.id,
            operationId: commandRequestId,
          },
          trx,
        );
        const exit = await this.withdrawals.exitIfDrained(
          workItem,
          { actorId: actor.id, operationId: commandRequestId },
          trx,
        );
        if (exit.exited) await this.settleExit(exit.workItem, trx);
        return {
          response: {
            shipmentId,
            workItemId: workItem.id,
            removedQty,
            exited: exit.exited,
            exitTo: exit.workItem.exitTo,
            waitingOperationId: exit.workItem.waitingOperationId,
            removals: exit.exited ? [] : await loadWithdrawalRemovals(trx, workItem.id),
          },
          resourceType: 'outbound_batch_work_item',
          resourceId: workItem.id,
        };
      },
      tx,
    );
    if (response.exited) await this.resumeAfterDraftExit([response], tx);
    return response;
  }

  /** 나간 박스의 정리 중 트랜잭션 안의 몫 — canceled 면 기다리던 전체 취소를 완료한다(정한 것 4). */
  async settleExit(workItem: WorkItemRow, trx: DbTx): Promise<void> {
    if (workItem.exitTo !== 'canceled') return;
    if (!workItem.waitingOperationId) {
      throw new Error(`Canceled exit of work item ${workItem.id} has no cancellation operation`);
    }
    await this.planning.finishWithdrawnCancellation(workItem.waitingOperationId, trx);
  }

  /** 커밋 뒤의 몫 — draft 로 나간 박스가 기다리던 오퍼레이션(합포장·옛 부분 취소)을 잇는다(PR 2 빼기와 같다). */
  async resumeAfterDraftExit(
    exits: Array<{ shipmentId: string; exitTo: string | null; waitingOperationId: string | null }>,
    tx?: DbTx,
  ): Promise<void> {
    for (const exit of exits) {
      if (exit.exitTo === 'draft' && exit.waitingOperationId) {
        await this.batches.resumeWaitingOperation(exit.waitingOperationId, exit.shipmentId, tx);
      }
    }
  }
}
