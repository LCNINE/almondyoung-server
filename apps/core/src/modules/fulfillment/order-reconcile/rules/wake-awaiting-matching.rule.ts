// apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { isFulfillableMatching } from '../../../product-matching/fulfillable-matching';
import { ProductSkuMappingService } from '../../../product-matching/services/product-sku-mapping.service';
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
  // 첫 배포는 관찰. 거짓 양성 0건을 확인한 뒤 PR 로 'act' 로 바꾼다(스펙 §7)
  readonly mode: ReconcileMode = 'observe';
  readonly situation: OrderReconcileSituation = { stage: 'fo', states: ['awaiting_matching'] };

  constructor(
    private readonly backlog: FulfillmentOrderCreationBacklogService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly skuMapping: ProductSkuMappingService,
  ) {}

  /**
   * 기다리는 variant 목록 + 각 매칭의 상태·전략·링크. updated_at 은 upsert 가 올리지 않아(링크만 갈아끼운다) 쓰지 않고,
   * check 가 판정하는 내용 자체를 읽는다 — 운영자가 매칭을 손보면 바뀌어 횟수·포기가 리셋된다.
   */
  async fingerprint(salesOrderId: string, tx: DbTx): Promise<string> {
    const ids = await this.waitingVariantIds(salesOrderId, tx);
    const parts: string[] = [];
    for (const id of ids) {
      const matching = await this.skuMapping.getByVariant(id, tx);
      if (!matching) {
        parts.push('none');
        continue;
      }
      const links = (matching.links ?? []).map((l) => `${l.skuId}:${l.quantity}`).sort();
      parts.push(`${matching.status}|${matching.strategy ?? ''}|${links.join(',')}`);
    }
    return `${ids.join(',')}|${parts.join(';')}`;
  }

  async check(salesOrderId: string, tx: DbTx): Promise<boolean> {
    // 정비 모드는 몇 시간 이어질 수 있다 — 시도로 세면 포기가 잘못 찍힌다(§4.4-5)
    if (!this.workflowGate.shouldRunFoCreation()) return false;
    const backlog = await this.backlog.findBySalesOrderId(salesOrderId, tx);
    if (!backlog || backlog.status !== 'awaiting_matching') return false;
    const ids = parseVariantIds(backlog.waitingVariantIds);
    if (ids.length === 0) return false;
    for (const id of ids) {
      if (!isFulfillableMatching(await this.skuMapping.getByVariant(id, tx))) return false;
    }
    return true;
  }

  /** CAS 가 진 경우(그새 다른 경로가 깨움)는 noop — 시도로 세지 않는다 */
  async act(salesOrderId: string, tx: DbTx): Promise<ReconcileActResult> {
    return (await this.backlog.requeueAwaitingMatching(salesOrderId, tx)) > 0 ? 'acted' : 'noop';
  }

  private async waitingVariantIds(salesOrderId: string, tx: DbTx): Promise<string[]> {
    const backlog = await this.backlog.findBySalesOrderId(salesOrderId, tx);
    return backlog ? parseVariantIds(backlog.waitingVariantIds) : [];
  }
}

/** jsonb 라 형식이 보장되지 않는다 — 문자열만 골라 정렬한다(지문이 순서에 흔들리지 않게). */
function parseVariantIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string'))].sort();
}
