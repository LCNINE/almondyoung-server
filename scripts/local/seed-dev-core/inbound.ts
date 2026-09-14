import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { PurchaseOrderReceivingManager } from '../../../apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.manager';
import { SEED_IDS, SEED_SKUS } from './constants';
import { SEED_ACTOR } from './shipments';

/** 예정일은 발주 라인이 갖는다. date 컬럼이므로 YYYY-MM-DD 리터럴로 고정한다. */
const EXPECTED_DATE = '2026-08-01';

/** 실행된 발주 라인의 결정론적 공통 필드. */
const ORDERED_AT = new Date('2026-07-25T00:00:00.000Z');
function executedLine(quantity: number) {
  return {
    quantity,
    status: 'ordered' as const,
    orderedQty: quantity,
    orderedAt: ORDERED_AT,
    orderedBy: SEED_ACTOR.id,
  };
}

/** 국내 발주 2라인과 해외 발주 1라인을 만들고, 해외 발주만 중국 창고에서 20개 부분 수령한다. */
export async function seedInbound(receiving: PurchaseOrderReceivingManager, tx: DbTx): Promise<void> {
  const [domesticPo] = await tx
    .insert(wmsTables.purchaseOrders)
    .values({
      type: 'domestic',
      supplierId: SEED_IDS.supplier,
      sourceWarehouseId: SEED_IDS.warehouseBucheon,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: false,
      status: 'confirmed',
    })
    .returning();

  await tx.insert(wmsTables.purchaseOrderLines).values([
    {
      poId: domesticPo.id,
      skuId: SEED_SKUS[0].id,
      unitPrice: null,
      expectedArrival: EXPECTED_DATE,
      ...executedLine(40),
    },
    {
      poId: domesticPo.id,
      skuId: SEED_SKUS[1].id,
      unitPrice: null,
      expectedArrival: EXPECTED_DATE,
      ...executedLine(25),
    },
  ]);

  const [foreignPo] = await tx
    .insert(wmsTables.purchaseOrders)
    .values({
      type: 'foreign',
      supplierId: SEED_IDS.supplier,
      sourceWarehouseId: SEED_IDS.warehouseChina,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: true,
      status: 'confirmed',
    })
    .returning();

  await tx.insert(wmsTables.purchaseOrderLines).values({
    poId: foreignPo.id,
    skuId: SEED_SKUS[2].id,
    unitPrice: null,
    expectedArrival: EXPECTED_DATE,
    ...executedLine(60),
  });

  // 해외 발주: 중국 창고에서 20 부분 수령 — 회차·원장·링크·received_qty 가 실제 경로로 생긴다.
  await receiving.receive(
    foreignPo.id,
    {
      idempotencyKey: `dev-seed-po-receive-${SEED_SKUS[2].code}`,
      warehouseId: SEED_IDS.warehouseChina,
      locationId: SEED_IDS.locChinaReceiving,
      lines: [{ skuId: SEED_SKUS[2].id, quantity: 20 }],
    },
    tx,
  );
}
