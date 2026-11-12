import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { WaybillManager, type Actor, type IssueOpts } from './waybill.manager';
import type { BatchResultItem, WaybillRow, WaybillView } from './waybill.types';

export function toView(row: WaybillRow): WaybillView {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    source: row.source,
    carrier: row.carrier,
    status: row.status,
    trackingNo: row.trackingNo,
    custOrdNo: row.custOrdNo,
    manifestVersion: row.manifestVersion,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : null,
    transientAttempts: row.transientAttempts,
  };
}

@Injectable()
export class WaybillService {
  private readonly logger = new Logger(WaybillService.name);

  @Inject(ModuleRef)
  private readonly moduleRef: ModuleRef;

  constructor(private readonly manager: WaybillManager) {}

  async issueForShipment(shipmentId: string, opts: IssueOpts, idemKey: string, actor: Actor): Promise<WaybillView> {
    return toView(await this.manager.issueForShipment(shipmentId, opts, idemKey, actor));
  }

  async resumeActive(shipmentId: string, opts: IssueOpts): Promise<WaybillView | null> {
    const row = await this.manager.resumeActive(shipmentId, opts);
    return row ? toView(row) : null;
  }

  async abandon(
    waybillId: string,
    dto: { reason: string },
    idemKey: string,
    actor: Actor,
    tx?: DbTx,
  ): Promise<WaybillView> {
    return toView(await this.manager.abandon(waybillId, dto, idemKey, actor, tx));
  }

  async registerManual(
    shipmentId: string,
    dto: { carrier: IssueOpts['carrier']; trackingNo: string; expectedManifestVersion: number; reason?: string },
    idemKey: string,
    actor: Actor,
    tx?: DbTx,
  ): Promise<WaybillView> {
    return toView(await this.manager.registerManual(shipmentId, dto, idemKey, actor, tx));
  }

  async void(
    waybillId: string,
    dto: { reason: string },
    idemKey: string,
    actor: Actor,
    tx?: DbTx,
  ): Promise<WaybillView> {
    const row = await this.manager.void(waybillId, dto, idemKey, actor, tx);

    // 외부 tx는 아직 커밋 전이다. 운영자 취소가 커밋된 뒤에만 별도 트랜잭션으로 재개한다.
    if (!tx) {
      await this.resumeAfterVoid(row.shipmentId);
    }

    return toView(row);
  }

  private async resumeAfterVoid(shipmentId: string): Promise<void> {
    try {
      const { ConsolidationService } = await import('../services/consolidation.service');
      const consolidation = this.moduleRef.get(ConsolidationService, { strict: false });
      const operationId = await consolidation.findPendingOperationIdForSource(shipmentId);

      if (operationId) {
        await consolidation.tryResumePending(operationId);
      }
    } catch (error) {
      this.logger.warn(`Failed to resume consolidation after waybill void: shipmentId=${shipmentId}`, error);
    }

    try {
      const { ShipmentPlanningService } = await import('../services/shipment-planning.service');
      const planning = this.moduleRef.get(ShipmentPlanningService, { strict: false });
      const operationId = await planning.findPendingCancellationOperationId(shipmentId);

      if (operationId) {
        await planning.tryResumePendingCancellation(operationId);
      }
    } catch (error) {
      this.logger.warn(`Failed to resume cancellation after waybill void: shipmentId=${shipmentId}`, error);
    }
  }

  async voidForRecall(
    shipmentId: string,
    dto: { reason: string },
    idemKey: string,
    actor: Actor,
    tx?: DbTx,
  ): Promise<WaybillView> {
    return toView(await this.manager.voidForRecall(shipmentId, dto, idemKey, actor, tx));
  }

  async reissue(shipmentId: string, opts: IssueOpts, idemKey: string, actor: Actor): Promise<WaybillView> {
    return toView(await this.manager.reissue(shipmentId, opts, idemKey, actor));
  }

  async getActiveWaybill(shipmentId: string, tx?: DbTx): Promise<WaybillView | null> {
    const row = await this.manager.getActiveWaybill(shipmentId, tx);
    return row ? toView(row) : null;
  }

  // 플랜 3 dispatch 소비:
  assertDispatchable(shipmentId: string, tx?: DbTx) {
    return this.manager.assertDispatchable(shipmentId, tx);
  }

  markUsed(shipmentId: string, tx?: DbTx) {
    return this.manager.markUsed(shipmentId, tx);
  }

  issueBatch(
    shipmentIds: string[],
    opts: { carrier: IssueOpts['carrier'] },
    idemKey: string,
    actor: Actor,
  ): Promise<BatchResultItem[]> {
    return this.manager.issueBatch(shipmentIds, opts, idemKey, actor);
  }
}
