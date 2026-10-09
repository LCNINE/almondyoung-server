// apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { OrderProgressReader } from '../../order-progress/order-progress.reader';
import { ConsolidationResumeReadiness, ConsolidationService } from '../../services/consolidation.service';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { ReconcileActResult, ShipmentReconcileRule, ShipmentReconcileSituation } from '../order-reconcile.rule';
import { ReconcileMode } from '../order-reconcile.state';
import { shipmentInSituation } from '../order-reconcile.subject';

/**
 * #1016 25번 행: 송장 등으로 막혀 CONSOLIDATION_PENDING 으로 멈춘 합포장을, 막힘이 풀린 뒤 재개한다.
 * 재개 신호는 «작업 항목이 배치에서 빠짐»(excludeShipment·박스 반환) 하나뿐이라 송장 취소로 풀린 경우는 영영 멈춰 있었다 —
 * 그 경로들에 재개를 더하지 않고 여기서 보장한다(스펙 D4). 첫 «상자 대상» 규칙이다(D20).
 */
@Injectable()
export class ResumePendingConsolidationRule implements ShipmentReconcileRule {
  readonly name = 'resume-pending-consolidation';
  readonly row = 25;
  readonly subject = 'shipment' as const;
  // 관찰로 배포해 거짓 양성 0건을 확인한 뒤 실행으로 바꾼다(스펙 D5·§7)
  readonly mode: ReconcileMode = 'observe';
  readonly situation: ShipmentReconcileSituation = { stage: 'pick', states: ['CONSOLIDATION_PENDING'] };

  constructor(
    private readonly consolidation: ConsolidationService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly progress: OrderProgressReader,
  ) {}

  async fingerprint(shipmentId: string, tx: DbTx): Promise<string> {
    const operationId = await this.consolidation.findPendingOperationIdForSource(shipmentId, tx);
    if (!operationId) return 'none';
    const readiness = await this.consolidation.resumeReadiness(operationId, tx);
    return readiness ? readinessFingerprint(readiness) : `${operationId}|not_pending`;
  }

  async check(shipmentId: string, tx: DbTx): Promise<boolean> {
    // 정비 모드는 몇 시간 이어질 수 있다 — 시도로 세면 포기가 잘못 찍힌다(§4.4-5)
    if (!this.workflowGate.allowsOperationalMutations()) return false;
    const operationId = await this.consolidation.findPendingOperationIdForSource(shipmentId, tx);
    if (!operationId) return false;
    const readiness = await this.consolidation.resumeReadiness(operationId, tx);
    if (!readiness || readiness.blockers.length > 0) return false;
    // 재개는 원본 전부를 한꺼번에 바꾼다. 틀의 게이트는 후보 상자 하나만 보므로, 형제 원본의 주문이 셀메이트 출고·채널 취소
    // 요청·반품 중이면 여기서 멈춘다 — 같은 판정(judgeShipment)과 같은 순수 함수(D16)를 원본마다 부른다
    const now = new Date();
    for (const source of readiness.sources) {
      if (!shipmentInSituation(this.situation, await this.progress.judgeShipment(source.shipmentId, now, tx)))
        return false;
    }
    return true;
  }

  /** 막힘이 남았거나(그새 새 송장) 이미 끝났으면(같은 작업의 다른 원본이 먼저 재개) noop — 시도로 세지 않는다(D13) */
  async act(shipmentId: string, tx: DbTx): Promise<ReconcileActResult> {
    const operationId = await this.consolidation.findPendingOperationIdForSource(shipmentId, tx);
    if (!operationId) return 'noop';
    return (await this.consolidation.tryResumePending(operationId, tx)) === 'completed' ? 'acted' : 'noop';
  }
}

/** 재개를 막거나 바꿀 수 있는 것 전부 — 운영자가 송장을 취소하거나 박스를 빼면 바뀌어 횟수·포기가 리셋된다. 순서에 흔들리지 않는다 */
export function readinessFingerprint(r: ConsolidationResumeReadiness): string {
  const sources = r.sources
    .map((s) => `${s.shipmentId}:${s.status}:${s.recoveryCode ?? ''}:${s.manifestVersion}:${s.reservationVersion}`)
    .sort();
  const blockers = r.blockers.map((b) => `${b.shipmentId}:${[...b.codes].sort().join('+')}`).sort();
  return `${r.operationId}|${sources.join(',')}|${blockers.join(',')}`;
}
