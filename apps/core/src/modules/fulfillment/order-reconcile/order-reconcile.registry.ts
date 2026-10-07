// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts
import { Type } from '@nestjs/common';
import { OrderReconcileRule } from './order-reconcile.rule';
import { WakeAwaitingMatchingRule } from './rules/wake-awaiting-matching.rule';

/**
 * 재판정 규칙 목록(스펙 §4.1). #1016 재판정 행을 닫을 때 여기 한 줄을 더하고, 규칙이 쓰는 도메인 모듈을
 * OrderReconcileModule 의 imports 에 더한다.
 */
export const ORDER_RECONCILE_RULE_CLASSES: Type<OrderReconcileRule>[] = [
  WakeAwaitingMatchingRule, // #1016 12번
];
