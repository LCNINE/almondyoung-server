import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { WaybillService } from '../waybill/waybill.service';
import { isVoidableOnExit } from './exit-waybill';
import { ShortPickOperationIntentProof, shortPickOperationIntentOf } from './batch-inventory-session.service';
import { ShipmentReservationService } from './shipment-reservation.service';

const OPS = wmsTables.shipmentOperations;

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * 결품으로 빠지는 박스의 마무리(스펙 §9-5, PR 4 계획이 정함 3·7). 나가기(`BoxWithdrawalService.exitIfDrained`)와
 * 전체 취소의 넘겨받기(`escalate`)만 부른다. 호출자가 구성요소·작업 항목·세션을 이미 잡았고, 결품 오퍼레이션 행은 그 뒤에 잡는다.
 */
@Injectable()
export class ShortPickExitService {
  constructor(
    private readonly reservations: ShipmentReservationService,
    private readonly waybills: WaybillService,
    private readonly audit: AuditService,
  ) {}

  /** 작업 항목이 기다리는 오퍼레이션이 진행 중인 결품이면 그 의도(행을 잠근다). 아니면 null. */
  async pendingFor(
    workItem: { id: string; waitingOperationId: string | null },
    trx: DbTx,
  ): Promise<ShortPickOperationIntentProof | null> {
    if (!workItem.waitingOperationId) return null;
    const [operation] = await trx
      .select({ type: OPS.type, status: OPS.status, snapshot: OPS.beforeManifestSnapshot })
      .from(OPS)
      .where(eq(OPS.id, workItem.waitingOperationId))
      .limit(1)
      .for('update');
    if (operation?.type !== 'short_pick' || operation.status !== 'pending') return null;
    const intent = shortPickOperationIntentOf(operation.snapshot);
    if (!intent || intent.workItemId !== workItem.id) {
      throw new Error(
        `Short-pick operation ${workItem.waitingOperationId} does not belong to work item ${workItem.id}`,
      );
    }
    return intent;
  }

  /** 송장 로컬 무효화 → 박스 draft → 부족분 예약 무효화 → 오퍼레이션 completed. 한 트랜잭션(호출자의 것). */
  async finish(
    intent: ShortPickOperationIntentProof,
    ctx: { actorId: string; operationId: string },
    trx: DbTx,
  ): Promise<{ voidedWaybillId: string | null }> {
    const shortByLine = new Map<string, number>();
    for (const line of intent.lines) {
      if (line.shortQty > 0)
        shortByLine.set(line.shipmentLineId, (shortByLine.get(line.shipmentLineId) ?? 0) + line.shortQty);
    }
    const active = await this.waybills.getActiveWaybill(intent.shipmentId, trx);
    if (active && !isVoidableOnExit(active)) {
      throw conflict(
        'WITHDRAWAL_WAYBILL_NOT_VOIDABLE',
        `Waybill ${active.id} is ${active.status}; resolve it before the short-picked box can leave its batch`,
      );
    }
    if (active) {
      await this.waybills.void(
        active.id,
        { reason: `short_pick:${intent.reason}` },
        `short-pick-exit:${intent.operationId}`,
        { id: ctx.actorId, roles: [] },
        trx,
      );
    }
    const [shipment] = await trx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, intent.shipmentId))
      .limit(1)
      .for('update');
    const [drafted] = shipment
      ? await trx
          .update(wmsTables.shipments)
          .set({
            status: 'draft',
            recoveryCode: null,
            plannedAt: null,
            manifestVersion: shipment.manifestVersion + 1,
            lastUpdated: new Date(),
          })
          .where(
            and(
              eq(wmsTables.shipments.id, shipment.id),
              eq(wmsTables.shipments.status, 'planned'),
              eq(wmsTables.shipments.manifestVersion, shipment.manifestVersion),
            ),
          )
          .returning()
      : [];
    if (!drafted)
      throw conflict('SHIPMENT_STALE_MANIFEST_VERSION', `Shipment ${intent.shipmentId} changed before short-pick exit`);
    await trx
      .update(wmsTables.shipmentLines)
      .set({ inspectedQty: 0, lineVersion: sql`${wmsTables.shipmentLines.lineVersion} + 1` })
      .where(eq(wmsTables.shipmentLines.shipmentId, intent.shipmentId));
    // planned 박스는 확정 예약 = 수량이라(불변식) 부족분을 무효화하기 전에 draft 로 내린다 — 옛 결품 보고가 recovery_required 로 먼저 내린 것과 같다.
    for (const [shipmentLineId, qty] of [...shortByLine].sort(([l], [r]) => l.localeCompare(r))) {
      await this.reservations.invalidateForShortPick(shipmentLineId, qty, intent.operationId, trx);
    }
    const after = {
      outcome: 'exited',
      shipment: drafted,
      retiredWorkItemId: intent.workItemId,
      voidedWaybillId: active?.id ?? null,
    };
    await this.complete(intent, after, drafted.manifestVersion, trx);
    await this.audit.logUserActionRequired(
      'shipment.short_pick.completed',
      'fulfillment',
      `Short pick operation ${intent.operationId} returned shipment ${intent.shipmentId} to Draft`,
      { userId: ctx.actorId },
      { operationId: intent.operationId, commandId: ctx.operationId, after },
      trx,
    );
    return { voidedWaybillId: active?.id ?? null };
  }

  /** 전체 취소가 넘겨받는다 — 결품 오퍼레이션만 닫는다. 예약·송장·박스는 취소 완료가 정리한다(정한 것 7). */
  async supersede(intent: ShortPickOperationIntentProof, cancellationOperationId: string, trx: DbTx): Promise<void> {
    await this.complete(intent, { outcome: 'superseded', supersededByOperationId: cancellationOperationId }, null, trx);
  }

  private async complete(
    intent: ShortPickOperationIntentProof,
    after: Record<string, unknown>,
    afterManifestVersion: number | null,
    trx: DbTx,
  ): Promise<void> {
    await trx
      .update(wmsTables.shipmentOperationMembers)
      .set({ ...(afterManifestVersion === null ? {} : { afterManifestVersion }), afterManifestSnapshot: after })
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, intent.operationId),
          eq(wmsTables.shipmentOperationMembers.shipmentId, intent.shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      );
    const [done] = await trx
      .update(OPS)
      .set({ status: 'completed', afterManifestSnapshot: after, lastError: null, completedAt: new Date() })
      .where(and(eq(OPS.id, intent.operationId), eq(OPS.status, 'pending')))
      .returning({ id: OPS.id });
    if (!done)
      throw conflict('SHORT_PICK_OPERATION_STALE', `Short-pick operation ${intent.operationId} is no longer pending`);
  }
}
