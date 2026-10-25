import { randomUUID } from 'crypto';
import { and, eq, inArray, max, notInArray } from 'drizzle-orm';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { reprojectFulfillmentOrders } from '../fulfillment-order/fulfillment-order-projection';
import {
  emitShipmentDispatched,
  incrementFulfillmentItems,
  markFullyShippedOrders,
  type DispatchEventDeps,
} from '../services/dispatch-effects';
import { lockShipmentConnectedComponentGraph } from '../services/shipment-reservation.service';
import { canonicalFulfillmentRequestHash } from '../services/fulfillment-command.service';
import { transitionShipments } from '../shipment/shipment-lifecycle';
import type { CarrierCode } from '../waybill/carrier/carrier-gateway.interface';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import type { WaybillRepository } from '../waybill/waybill.repository';
import { WaybillTrackingLiveConflictError } from '../waybill/waybill.errors';
import { SupplierShipmentNotShippableError, SupplierTrackingInUseError } from './supplier-shipment.errors';

/** 호출자(Nest 서비스)가 주입받아 넘기는 평범한 객체 — provider 가 아니다. */
export type SupplierDispatchDeps = DispatchEventDeps & {
  audit: Pick<AuditService, 'logUserActionRequired'>;
  waybills: Pick<WaybillRepository, 'insertSupplierManualUsed' | 'casUsedToVoided'>;
};

/** 송장번호 저장·비교 형태 — 앞뒤 공백·하이픈·내부 공백을 지운다. 쓰는 곳은 이 함수 하나여야 한다. */
export function normalizeTrackingNo(raw: string): string {
  return raw.replace(/[-\s]/g, '');
}

export interface SupplierDispatchCommand {
  shipmentId: string;
  carrier: CarrierCode;
  trackingNo: string;
  actorId: string;
  at: Date;
}

/**
 * 넘긴 입점사 상자 하나를 수기 송장 하나로 발송한다(K3, ADR-0050). 창고 발송(`dispatchLocked`)과 달리
 * 재고 원장·예약·피킹을 건드리지 않고, 발송 뒤 효과(수량·FO 발송 시각·이벤트 넷)는 주인 중립 모듈을 같이 쓴다.
 * 상자를 `FOR UPDATE` 로 직접 잠근다 — 호출자가 잠갔다고 가정하지 않는다.
 */
export async function shipSupplierShipment(
  deps: SupplierDispatchDeps,
  tx: DbTx,
  cmd: SupplierDispatchCommand,
): Promise<{ attemptId: string; attemptNo: number; waybillId: string }> {
  const trackingNo = normalizeTrackingNo(cmd.trackingNo);
  if (!trackingNo) throw new BadRequestError('trackingNo is required');

  // 공유 락 순서(FOI → 상자 → 라인 → 예약) — 상자를 먼저 잠그면 FOI 먼저 잡는 취소·라인 수정과 교착한다.
  // 시드 FOI 는 낙관적으로 읽고, 락 뒤에 상자를 다시 읽어 검증한다.
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
  if (
    shipment.supplierId === null ||
    shipment.status !== 'draft' ||
    shipment.recoveryCode !== null ||
    shipment.supplierHandoffId === null
  ) {
    throw new SupplierShipmentNotShippableError(
      `Shipment ${shipment.id} cannot be shipped by the supplier (status ${shipment.status}, ${
        shipment.supplierId === null ? 'warehouse' : 'supplier'
      } box, handed off ${shipment.supplierHandoffId !== null}, recovery ${shipment.recoveryCode ?? 'none'})`,
    );
  }
  const lines = await tx
    .select()
    .from(wmsTables.shipmentLines)
    .where(eq(wmsTables.shipmentLines.shipmentId, shipment.id))
    .orderBy(wmsTables.shipmentLines.id);
  if (lines.length === 0) {
    throw new SupplierShipmentNotShippableError(`Shipment ${shipment.id} (status ${shipment.status}) has no lines`);
  }
  const [active] = await tx
    .select({ id: wmsTables.waybills.id })
    .from(wmsTables.waybills)
    .where(
      and(
        eq(wmsTables.waybills.shipmentId, shipment.id),
        notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
      ),
    )
    .limit(1);
  if (active) {
    throw new SupplierShipmentNotShippableError(
      `Shipment ${shipment.id} (status ${shipment.status}) already has an active waybill`,
    );
  }
  const [taken] = await tx
    .select({ id: wmsTables.waybills.id })
    .from(wmsTables.waybills)
    .where(
      and(
        eq(wmsTables.waybills.trackingNo, trackingNo),
        notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
      ),
    )
    .limit(1);
  if (taken) throw new SupplierTrackingInUseError(`Tracking number ${trackingNo} is already in use`);

  let waybill: { id: string };
  try {
    waybill = await deps.waybills.insertSupplierManualUsed(tx, {
      shipmentId: shipment.id,
      carrier: cmd.carrier,
      trackingNo,
      manifestVersion: shipment.manifestVersion,
      recipientHash: canonicalFulfillmentRequestHash(shipment.recipientSnapshot),
    });
  } catch (e) {
    if (e instanceof WaybillTrackingLiveConflictError) {
      throw new SupplierTrackingInUseError(`Tracking number ${trackingNo} is already in use`);
    }
    throw e;
  }

  const [attemptNoRow] = await tx
    .select({ attemptNo: max(wmsTables.dispatchAttempts.attemptNo) })
    .from(wmsTables.dispatchAttempts)
    .where(eq(wmsTables.dispatchAttempts.shipmentId, shipment.id));
  const attemptNo = Number(attemptNoRow?.attemptNo ?? 0) + 1;
  const attemptId = randomUUID();
  await tx.insert(wmsTables.dispatchAttempts).values({
    id: attemptId,
    shipmentId: shipment.id,
    attemptNo,
    kind: 'supplier',
    status: 'dispatched',
    idempotencyKey: `supplier-dispatch:${shipment.id}:${attemptNo}`,
    waybillId: waybill.id,
    dispatchedAt: cmd.at,
  });

  await transitionShipments(tx, {
    shipmentIds: [shipment.id],
    from: ['draft'],
    to: 'shipped',
    at: cmd.at,
    stale: 'unreachable',
  });

  await incrementFulfillmentItems(tx, lines, cmd.at);
  // N8 — 발송된 줄의 «못 보냄» 기록은 지운다. 기록은 «지금 못 보낸다»는 주장이다.
  await tx
    .update(wmsTables.shipmentLines)
    .set({ unfulfillableReason: null, unfulfillableReportedAt: null, unfulfillableReportedBy: null })
    .where(eq(wmsTables.shipmentLines.shipmentId, shipment.id));
  const foiRows = await tx
    .select({ fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
    .from(wmsTables.fulfillmentOrderItems)
    .where(
      inArray(
        wmsTables.fulfillmentOrderItems.id,
        lines.map((line) => line.fulfillmentOrderItemId),
      ),
    );
  await reprojectFulfillmentOrders(
    tx,
    foiRows.map((row) => row.fulfillmentOrderId),
    cmd.at,
  );
  const summaries = await markFullyShippedOrders(tx, lines, cmd.at);

  await emitShipmentDispatched(deps, tx, {
    origin: { supplierId: shipment.supplierId },
    shipmentId: shipment.id,
    attemptId,
    attemptNo,
    dispatchedAt: cmd.at,
    waybill: { id: waybill.id, carrier: cmd.carrier, trackingNo },
    summaries,
  });
  await deps.audit.logUserActionRequired(
    'shipment.dispatch',
    'fulfillment',
    `Dispatched supplier shipment ${shipment.id} as attempt ${attemptNo}`,
    { userId: cmd.actorId },
    {
      shipmentId: shipment.id,
      dispatchAttemptId: attemptId,
      attemptNo,
      owner: 'supplier',
      supplierId: shipment.supplierId,
      forcedQuantities: [],
    },
    tx,
  );
  return { attemptId, attemptNo, waybillId: waybill.id };
}
