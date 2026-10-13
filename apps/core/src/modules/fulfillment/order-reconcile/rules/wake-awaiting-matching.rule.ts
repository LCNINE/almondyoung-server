// apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import {
  blocksFulfillment,
  LineCompositionResolution,
} from '../../../product-matching/line-composition/line-composition';
import { LineCompositionReader } from '../../../product-matching/line-composition/line-composition.reader';
import { FulfillmentOrderCreationBacklogService } from '../../backlog/fulfillment-order-creation-backlog.service';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { OrderReconcileRule, OrderReconcileSituation, ReconcileActResult } from '../order-reconcile.rule';
import { ReconcileMode } from '../order-reconcile.state';

/**
 * #1016 12번 행: 매칭이 바뀌었는데 깨우는 신호를 놓쳐 잠든 매칭 대기 주문을 깨운다(스펙 2026-10-08 §5.4).
 * changeMatchingStrategy 등 wake 를 부르지 않는 경로가 원인이다 — 그 경로에 wake 를 더하지 않고 여기서 보장한다(D4).
 */
@Injectable()
export class WakeAwaitingMatchingRule implements OrderReconcileRule {
  readonly name = 'wake-awaiting-matching';
  readonly row = 12;
  readonly subject = 'order' as const;
  // 관찰로 배포해 거짓 양성 0건을 확인한 뒤 실행으로 바꿨다(스펙 §7). 실행 직전 judge 게이트(D12)와
  // 도메인 가드(셀메이트 출고 주문엔 FO 를 만들지 않는다, §5.1)가 함께 막는다
  readonly mode: ReconcileMode = 'act';
  readonly situation: OrderReconcileSituation = { stage: 'fo', states: ['awaiting_matching'] };

  constructor(
    private readonly backlog: FulfillmentOrderCreationBacklogService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly lineCompositions: LineCompositionReader,
  ) {}

  /**
   * 라인별 판정 결과(종류·구성·사유)와 유효 수량. 운영자가 상품매칭을 손보거나 라인을 굳히면 바뀌어 횟수·포기가 리셋된다.
   * 대기 목록(waitingVariantIds)을 보지 않는다 — 1회 지정은 variant 가 아니라 라인을 푼다(#1063 스펙 §5.3-2).
   */
  async fingerprint(salesOrderId: string, tx: DbTx): Promise<string> {
    const resolved = await this.lineCompositions.resolveForOrder(salesOrderId, tx);
    return resolved
      .map((r) => `${r.line.id}:${r.fulfillableQuantity}:${describeResolution(r.resolution)}`)
      .sort()
      .join(';');
  }

  async check(salesOrderId: string, tx: DbTx): Promise<boolean> {
    // 정비 모드는 몇 시간 이어질 수 있다 — 시도로 세면 포기가 잘못 찍힌다(§4.4-5)
    if (!this.workflowGate.shouldRunFoCreation()) return false;
    const backlog = await this.backlog.findBySalesOrderId(salesOrderId, tx);
    if (!backlog || backlog.status !== 'awaiting_matching') return false;
    const resolved = await this.lineCompositions.resolveForOrder(salesOrderId, tx);
    return resolved.length > 0 && !resolved.some(blocksFulfillment);
  }

  /** CAS 가 진 경우(그새 다른 경로가 깨움)는 noop — 시도로 세지 않는다 */
  async act(salesOrderId: string, tx: DbTx): Promise<ReconcileActResult> {
    return (await this.backlog.requeueAwaitingMatching(salesOrderId, tx)) > 0 ? 'acted' : 'noop';
  }
}

function describeResolution(resolution: LineCompositionResolution): string {
  switch (resolution.kind) {
    case 'frozen':
      return `frozen/${resolution.source}/${resolution.items.map((i) => `${i.skuId}x${i.qtyPerUnit}`).join(',')}`;
    case 'follow':
      return `follow/${resolution.items.map((i) => `${i.skuId}x${i.qtyPerUnit}`).join(',')}`;
    case 'missing':
      return `missing/${resolution.reason}`;
    default:
      return resolution.kind;
  }
}
