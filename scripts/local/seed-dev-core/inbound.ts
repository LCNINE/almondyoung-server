import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS, SEED_SKUS } from './constants';

/** 리셋마다 같은 날짜가 나오도록 고정한다 (결정론 규약). */
const EXPECTED_DATE = new Date('2026-08-01T00:00:00.000Z');

/**
 * 국내 PO 1건(부천 단일 plan) + 해외 PO 1건(중국 source → 부천 destination 2-plan).
 * 상태는 pending / receiving / confirmed 를 하나씩 만들어 Phase 2 화면이 세 갈래를 다 본다.
 */
export async function seedInbound(tx: DbTx): Promise<void> {
  const [domesticPo] = await tx
    .insert(wmsTables.purchaseOrders)
    .values({
      type: 'domestic',
      supplierId: null,
      sourceWarehouseId: SEED_IDS.warehouseBucheon,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: false,
      expectedArrival: EXPECTED_DATE,
      status: 'confirmed',
      auditStatus: 'approved',
    })
    .returning();

  await tx.insert(wmsTables.purchaseOrderLines).values([
    { poId: domesticPo.id, skuId: SEED_SKUS[0].id, quantity: 40, unitPrice: null },
    { poId: domesticPo.id, skuId: SEED_SKUS[1].id, quantity: 25, unitPrice: null },
  ]);

  const [domesticPlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: SEED_IDS.warehouseBucheon,
      planType: 'destination',
      linkedPurchaseOrderId: domesticPo.id,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: false,
      expectedDate: EXPECTED_DATE,
      status: 'pending',
    })
    .returning();

  await tx.insert(wmsTables.inboundPlanItems).values([
    { planId: domesticPlan.id, skuId: SEED_SKUS[0].id, expectedQty: 40, receivedQty: 0, status: 'pending' },
    { planId: domesticPlan.id, skuId: SEED_SKUS[1].id, expectedQty: 25, receivedQty: 0, status: 'pending' },
  ]);

  const [foreignPo] = await tx
    .insert(wmsTables.purchaseOrders)
    .values({
      type: 'foreign',
      supplierId: null,
      sourceWarehouseId: SEED_IDS.warehouseChina,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: true,
      expectedArrival: EXPECTED_DATE,
      status: 'confirmed',
      auditStatus: 'approved',
    })
    .returning();

  await tx
    .insert(wmsTables.purchaseOrderLines)
    .values([{ poId: foreignPo.id, skuId: SEED_SKUS[2].id, quantity: 60, unitPrice: null }]);

  // source plan: 부분입고 중 (receiving)
  const [sourcePlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: SEED_IDS.warehouseChina,
      planType: 'source',
      linkedPurchaseOrderId: foreignPo.id,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: true,
      expectedDate: EXPECTED_DATE,
      status: 'receiving',
    })
    .returning();

  await tx
    .insert(wmsTables.inboundPlanItems)
    .values([{ planId: sourcePlan.id, skuId: SEED_SKUS[2].id, expectedQty: 60, receivedQty: 20, status: 'receiving' }]);

  // destination plan: 입고 완료 (confirmed)
  const [destinationPlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: SEED_IDS.warehouseBucheon,
      planType: 'destination',
      parentPlanId: sourcePlan.id,
      linkedPurchaseOrderId: foreignPo.id,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: false,
      expectedDate: null,
      status: 'confirmed',
    })
    .returning();

  await tx
    .insert(wmsTables.inboundPlanItems)
    .values([
      { planId: destinationPlan.id, skuId: SEED_SKUS[2].id, expectedQty: 60, receivedQty: 60, status: 'confirmed' },
    ]);
}
