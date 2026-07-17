import { Injectable } from '@nestjs/common';
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
  };
}

@Injectable()
export class WaybillService {
  constructor(private readonly manager: WaybillManager) {}

  async issueForShipment(shipmentId: string, opts: IssueOpts, idemKey: string, actor: Actor): Promise<WaybillView> {
    return toView(await this.manager.issueForShipment(shipmentId, opts, idemKey, actor));
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
    return toView(await this.manager.void(waybillId, dto, idemKey, actor, tx));
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
