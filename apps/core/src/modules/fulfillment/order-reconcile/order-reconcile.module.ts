// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts
import { Module } from '@nestjs/common';
import { ProductMatchingModule } from '../../product-matching/product-matching.module';
import { FulfillmentOrderCreationBacklogModule } from '../backlog/fulfillment-order-creation-backlog.module';
import { OrderProgressModule } from '../order-progress/order-progress.module';
import { OrderReconcileJob } from './order-reconcile.job';
import { ORDER_RECONCILE_RULE_CLASSES } from './order-reconcile.registry';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { ORDER_RECONCILE_RULES, OrderReconcileRule } from './order-reconcile.rule';
import { OrderReconcileRunner } from './order-reconcile.runner';

/**
 * 주문 리컨실러(스펙 docs/superpowers/specs/2026-10-08-order-reconciler-design.md). 정체 보드 투영을 읽어
 * 깨우는 신호를 놓친 주문을 다시 판정한다. DbModule 은 전역.
 */
@Module({
  imports: [FulfillmentOrderCreationBacklogModule, ProductMatchingModule, OrderProgressModule],
  providers: [
    OrderReconcileRepository,
    OrderReconcileRunner,
    OrderReconcileJob,
    ...ORDER_RECONCILE_RULE_CLASSES,
    {
      provide: ORDER_RECONCILE_RULES,
      useFactory: (...rules: OrderReconcileRule[]) => rules,
      inject: [...ORDER_RECONCILE_RULE_CLASSES],
    },
  ],
})
export class OrderReconcileModule {}
