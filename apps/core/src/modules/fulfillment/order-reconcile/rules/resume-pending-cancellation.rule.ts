// apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-cancellation.rule.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { CancellationResumeReadiness, ShipmentPlanningService } from '../../services/shipment-planning.service';
import { ReconcileActResult, ShipmentReconcileRule, ShipmentReconcileSituation } from '../order-reconcile.rule';
import { ReconcileMode } from '../order-reconcile.state';

/**
 * #1016 30번 행: 막힘(발급 중인 송장 등) 때문에 CANCEL_REPLAN_PENDING 으로 멈춘 취소를, 막힘이 풀린 뒤 재개한다.
 * 송장이 registered·failed 로 굳는 것에는 재개 신호가 없다(스펙 §4.2).
 */
@Injectable()
export class ResumePendingCancellationRule implements ShipmentReconcileRule {
  readonly name = 'resume-pending-cancellation';
  readonly row = 30;
  readonly subject = 'shipment' as const;
  // 컷오버 예외: core 출고가 돌기 전엔 planned 이후 상자의 대기 취소가 생기지 않아 관찰로는 아무것도 증명되지 않는다(스펙 §4.2)
  readonly mode: ReconcileMode = 'act';
  readonly situation: ShipmentReconcileSituation = { stage: 'cancel', states: ['CANCEL_REPLAN_PENDING'] };

  constructor(
    private readonly planning: ShipmentPlanningService,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  async fingerprint(shipmentId: string, tx: DbTx): Promise<string> {
    const operationId = await this.planning.findPendingCancellationOperationId(shipmentId, tx);

    if (!operationId) return 'none';

    const readiness = await this.planning.cancellationResumeReadiness(operationId, tx);

    return readiness ? cancellationReadinessFingerprint(readiness) : `${operationId}|not_pending`;
  }

  /** 취소된 주문·정산 중 주문을 거르지 않는다 — 셀프취소로 대기에 간 상자가 이 규칙의 주 대상이다(스펙 §4.2) */
  async check(shipmentId: string, tx: DbTx): Promise<boolean> {
    // 정비 모드는 몇 시간 이어질 수 있다 — 시도로 세면 포기가 잘못 찍힌다
    if (!this.workflowGate.allowsOperationalMutations()) return false;

    const operationId = await this.planning.findPendingCancellationOperationId(shipmentId, tx);

    if (!operationId) return false;

    const readiness = await this.planning.cancellationResumeReadiness(operationId, tx);

    return readiness !== null && readiness.blockers.length === 0;
  }

  /**
   * 막힘이 그새 생겼거나 이미 끝났으면 noop — 시도로 세지 않는다(D13). 상태가 갈린 CANCELLATION_* 충돌과
   * 시작 전 배치 빼기 사유는 던져 틀이 물러서게 한다.
   */
  async act(shipmentId: string, tx: DbTx): Promise<ReconcileActResult> {
    const operationId = await this.planning.findPendingCancellationOperationId(shipmentId, tx);

    if (!operationId) return 'noop';

    return (await this.planning.tryResumePendingCancellation(operationId, tx)) === 'completed' ? 'acted' : 'noop';
  }
}

/** 재개를 막는 것 전부 — 송장이 굳거나 운영자가 원인을 고치면 바뀌어 횟수·포기가 리셋된다. 순서에 흔들리지 않는다 */
export function cancellationReadinessFingerprint(r: CancellationResumeReadiness): string {
  return `${r.operationId}|${[...r.blockers].sort().join('+')}`;
}
