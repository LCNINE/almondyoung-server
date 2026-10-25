import { and, eq, ne, notInArray } from 'drizzle-orm';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { lockShipmentConnectedComponentGraph } from '../services/shipment-reservation.service';
import type { CarrierCode } from '../waybill/carrier/carrier-gateway.interface';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { WaybillTrackingLiveConflictError } from '../waybill/waybill.errors';
import type { WaybillRepository } from '../waybill/waybill.repository';
import { normalizeTrackingNo } from './supplier-dispatch';
import {
  SupplierReasonOnShippedError,
  SupplierShipmentNotShippableError,
  SupplierTrackingInUseError,
} from './supplier-shipment.errors';

export type SupplierCorrectionDeps = {
  waybills: Pick<WaybillRepository, 'insertSupplierManualUsed' | 'casUsedToVoided'>;
};

export interface SupplierCorrectionCommand {
  shipmentId: string;
  carrier: CarrierCode;
  trackingNo: string;
  actorId: string;
  at: Date;
}

/**
 * 발송된 입점사 상자의 송장번호를 정정한다(N9) — 옛 수기 송장 used → voided, 새 수기 송장 used, 시도의 waybill_id 를 새 송장으로.
 * 상자 상태·manifest_version·이벤트는 건드리지 않는다. 같은 (택배사, 번호)면 아무것도 하지 않고 지금 송장 id 를 돌려준다.
 */
export async function correctSupplierWaybill(
  deps: SupplierCorrectionDeps,
  tx: DbTx,
  cmd: SupplierCorrectionCommand,
): Promise<{ waybillId: string }> {
  const trackingNo = normalizeTrackingNo(cmd.trackingNo);
  if (!trackingNo) throw new BadRequestError('trackingNo is required');

  const seedLines = await tx
    .select({ fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId })
    .from(wmsTables.shipmentLines)
    .where(eq(wmsTables.shipmentLines.shipmentId, cmd.shipmentId));
  if (seedLines.length === 0) {
    const [exists] = await tx
      .select({ id: wmsTables.shipments.id })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, cmd.shipmentId))
      .limit(1);
    if (!exists) throw new NotFoundError(`Shipment ${cmd.shipmentId} not found`);
    throw new SupplierShipmentNotShippableError(`Shipment ${cmd.shipmentId} has no lines`);
  }
  // 공유 락 순서(FOI → 상자 → 라인)
  await lockShipmentConnectedComponentGraph(
    tx,
    seedLines.map((line) => line.fulfillmentOrderItemId),
  );
  const [shipment] = await tx
    .select()
    .from(wmsTables.shipments)
    .where(eq(wmsTables.shipments.id, cmd.shipmentId))
    .limit(1)
    .for('update');
  if (!shipment) throw new NotFoundError(`Shipment ${cmd.shipmentId} not found`);
  if (shipment.supplierId === null || shipment.status !== 'shipped') {
    throw new SupplierShipmentNotShippableError(
      `Shipment ${shipment.id} cannot be corrected (status ${shipment.status}, ${
        shipment.supplierId === null ? 'warehouse' : 'supplier'
      } box)`,
    );
  }
  const [current] = await tx
    .select()
    .from(wmsTables.waybills)
    .where(and(eq(wmsTables.waybills.shipmentId, shipment.id), eq(wmsTables.waybills.status, 'used')))
    .limit(1);
  if (!current) {
    throw new SupplierShipmentNotShippableError(`Shipment ${shipment.id} has no used waybill to correct`);
  }
  if (current.carrier === cmd.carrier && current.trackingNo === trackingNo) return { waybillId: current.id };

  const [taken] = await tx
    .select({ id: wmsTables.waybills.id })
    .from(wmsTables.waybills)
    .where(
      and(
        eq(wmsTables.waybills.trackingNo, trackingNo),
        ne(wmsTables.waybills.id, current.id),
        notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
      ),
    )
    .limit(1);
  if (taken) throw new SupplierTrackingInUseError(`Tracking number ${trackingNo} is already in use`);

  // 상자당 비종결 송장 하나(uq_waybills_shipment_active)·살아 있는 번호 하나 — 옛 송장을 먼저 무효로 한다.
  const voided = await deps.waybills.casUsedToVoided(tx, shipment.id, cmd.at);
  if (voided !== 1) {
    throw new SupplierShipmentNotShippableError(`Shipment ${shipment.id} used waybill changed concurrently`);
  }
  let created: { id: string };
  try {
    created = await deps.waybills.insertSupplierManualUsed(tx, {
      shipmentId: shipment.id,
      carrier: cmd.carrier,
      trackingNo,
      manifestVersion: shipment.manifestVersion,
      recipientHash: current.recipientHash,
    });
  } catch (e) {
    if (e instanceof WaybillTrackingLiveConflictError) {
      throw new SupplierTrackingInUseError(`Tracking number ${trackingNo} is already in use`);
    }
    throw e;
  }
  await tx
    .update(wmsTables.dispatchAttempts)
    .set({ waybillId: created.id })
    .where(
      and(eq(wmsTables.dispatchAttempts.shipmentId, shipment.id), eq(wmsTables.dispatchAttempts.waybillId, current.id)),
    );
  return { waybillId: created.id };
}

export interface ReportUnfulfillableCommand {
  shipmentLineId: string;
  reason: string;
  actorId: string;
  at: Date;
}

/** 입점사가 «못 보낸다»고 알린 것을 draft 입점사 상자의 라인에 적는다. 라인 수량은 바꾸지 않는다(취소·환불은 별건). */
export async function reportUnfulfillable(
  tx: DbTx,
  cmd: ReportUnfulfillableCommand,
): Promise<'recorded' | 'unchanged'> {
  const reason = cmd.reason.trim();
  if (!reason) throw new BadRequestError('reason is required');

  const [seed] = await tx
    .select({
      shipmentId: wmsTables.shipmentLines.shipmentId,
      fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
    })
    .from(wmsTables.shipmentLines)
    .where(eq(wmsTables.shipmentLines.id, cmd.shipmentLineId))
    .limit(1);
  if (!seed) throw new NotFoundError(`Shipment line ${cmd.shipmentLineId} not found`);
  await lockShipmentConnectedComponentGraph(tx, [seed.fulfillmentOrderItemId]);

  const [shipment] = await tx
    .select()
    .from(wmsTables.shipments)
    .where(eq(wmsTables.shipments.id, seed.shipmentId))
    .limit(1)
    .for('update');
  if (!shipment || shipment.supplierId === null || shipment.status !== 'draft') {
    throw new SupplierReasonOnShippedError(`Shipment line ${cmd.shipmentLineId} is not on a draft supplier shipment`);
  }
  const [line] = await tx
    .select()
    .from(wmsTables.shipmentLines)
    .where(and(eq(wmsTables.shipmentLines.id, cmd.shipmentLineId), eq(wmsTables.shipmentLines.shipmentId, shipment.id)))
    .limit(1)
    .for('update');
  if (!line) throw new NotFoundError(`Shipment line ${cmd.shipmentLineId} not found`);
  if (line.unfulfillableReason === reason) return 'unchanged';
  await tx
    .update(wmsTables.shipmentLines)
    .set({ unfulfillableReason: reason, unfulfillableReportedAt: cmd.at, unfulfillableReportedBy: cmd.actorId })
    .where(eq(wmsTables.shipmentLines.id, line.id));
  return 'recorded';
}
