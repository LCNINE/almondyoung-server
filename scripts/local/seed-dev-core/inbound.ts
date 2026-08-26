import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { InboundService } from '../../../apps/core/src/modules/inventory/inbound/services/inbound.service';
import { SEED_IDS, SEED_SKUS } from './constants';
import { SEED_ACTOR } from './shipments';

/** 리셋마다 같은 날짜가 나오도록 고정한다 (결정론 규약). */
/** 예정일은 헤더/계획이 아니라 라인·아이템이 갖는다(#724 항목 9). date 컬럼이라 'YYYY-MM-DD'. */
const EXPECTED_DATE = '2026-08-01';

/**
 * 실행된 라인의 공통 필드. **헤더를 `confirmed` 로 심으려면 라인이 종결돼 있어야 한다** —
 * 헤더 status 는 라인에서 파생되고(`refreshHeaderStatus`), 계획 아이템은 `ordered` 라인에서만
 * 생긴다(`executeLineOrder`). 라인을 기본값 `requested` 로 두면 실제 코드로는 만들 수 없는
 * 상태가 되고, 그 순간 발주 헤더 도착예정일(실발주 라인 기준)과 입고 계획 예정일이 갈린다.
 *
 * `orderedAt` 은 결정론 규약에 따라 고정 시각이다 — 리셋마다 값이 흔들리면 안 된다.
 */
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

/**
 * 국내 PO 1건(부천 단일 plan) + 해외 PO 1건(중국 source → 부천 destination 2-plan).
 *
 * PO/plan/plan-item 생성은 순수 마스터 데이터라 직접 insert 한다 (정합성이 걸린 전이가 없다).
 * 하지만 plan item 의 receivedQty/status 는 실제 입고 흐름에서 stock_events/stock_ledgers 와
 * 항상 같은 트랜잭션으로 묶여 움직인다 (inbound.service.ts 의 receiveFromPlan) — 그래서 이
 * 필드들은 직접 쓰지 않고 반드시 InboundService.receiveFromPlan 을 호출해 만든다. 그래야
 * 재고 원장이 "앱이 실제로 만들 수 있는 상태"와 어긋나지 않는다.
 *
 * 국내 plan 은 receiveFromPlan 을 전혀 태우지 않는다 — SEED_SKUS[0]/[1] 은 stock.ts 가
 * 의도적으로 재고 0으로 남겨 품절 케이스를 만드는 SKU 라, 여기서 입고를 태우면 그 케이스가
 * 깨진다.
 */
export async function seedInbound(inboundService: InboundService, tx: DbTx): Promise<void> {
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

  // 국내 plan: 입고 전혀 안 태움 — pending / receivedQty 0 그대로 유지.
  const [domesticPlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: SEED_IDS.warehouseBucheon,
      planType: 'destination',
      linkedPurchaseOrderId: domesticPo.id,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: false,
      status: 'pending',
    })
    .returning();

  await tx.insert(wmsTables.inboundPlanItems).values([
    {
      planId: domesticPlan.id,
      skuId: SEED_SKUS[0].id,
      expectedQty: 40,
      receivedQty: 0,
      status: 'pending',
      expectedDate: EXPECTED_DATE,
    },
    {
      planId: domesticPlan.id,
      skuId: SEED_SKUS[1].id,
      expectedQty: 25,
      receivedQty: 0,
      status: 'pending',
      expectedDate: EXPECTED_DATE,
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

  await tx.insert(wmsTables.purchaseOrderLines).values([
    {
      poId: foreignPo.id,
      skuId: SEED_SKUS[2].id,
      unitPrice: null,
      expectedArrival: EXPECTED_DATE,
      ...executedLine(60),
    },
  ]);

  // source plan (중국): 시작은 pending / receivedQty 0.
  const [sourcePlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: SEED_IDS.warehouseChina,
      planType: 'source',
      linkedPurchaseOrderId: foreignPo.id,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: true,
      status: 'pending',
    })
    .returning();

  const [sourceItem] = await tx
    .insert(wmsTables.inboundPlanItems)
    .values([
      {
        planId: sourcePlan.id,
        skuId: SEED_SKUS[2].id,
        expectedQty: 60,
        receivedQty: 0,
        status: 'pending',
        expectedDate: EXPECTED_DATE,
      },
    ])
    .returning();

  // destination plan (부천): 시작은 pending / receivedQty 0. parent_plan_id 로 source plan 참조.
  const [destinationPlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: SEED_IDS.warehouseBucheon,
      planType: 'destination',
      parentPlanId: sourcePlan.id,
      linkedPurchaseOrderId: foreignPo.id,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: false,
      status: 'pending',
    })
    .returning();

  const [destinationItem] = await tx
    .insert(wmsTables.inboundPlanItems)
    .values([
      {
        planId: destinationPlan.id,
        skuId: SEED_SKUS[2].id,
        expectedQty: 60,
        receivedQty: 0,
        status: 'pending',
        expectedDate: EXPECTED_DATE,
      },
    ])
    .returning();

  // 실입고 처리 — receivedQty/status 는 여기서만 바뀐다. 도메인 서비스가 같은 트랜잭션 안에서
  // stock_events + stock_ledgers 를 함께 움직이므로, 시드가 끝나면 재고 원장이 이 두 호출과
  // 정확히 일치한다.
  //
  // locationId 를 명시적으로 master-data.ts 의 RECEIVING_DEFAULT 존으로 지정한다 — 생략하면
  // receiveFromPlan 이 LocationService.ensureSystemLocations 를 태우는데, 이 메서드는
  // (마스터 데이터가 미리 만들어두지 않은) outbound_rework 존까지 함께 보장해버려 창고당
  // 로케이션이 하나씩 더 생긴다. 같은 RECEIVING_DEFAULT 존을 고른다는 결과는 동일하므로
  // 이건 파라미터를 지어내는 게 아니라(DTO 가 실제로 받는 옵션 필드), 부수효과 없는 선택이다.
  //
  // source plan: 60개 중 20개만 부분입고. inbound.service.ts 의 실제 로직은 이진(완료 미만이면
  // 'pending', 완료면 'confirmed')이라 부분입고 상태에서도 item.status 는 'pending' 으로
  // 남는다 — 이 값은 여기서 만들어내는 게 아니라 도메인이 실제로 산출하는 값 그대로다.
  await inboundService.receiveFromPlan(
    {
      planItemId: sourceItem.id,
      quantity: 20,
      locationId: SEED_IDS.locChinaReceiving,
      // 결정론 규약 — 같은 리셋을 반복해도 같은 키가 나온다 (stock.ts 의 dev-seed- 네이밍과 짝).
      idempotencyKey: `dev-seed-inbound-receive-${SEED_SKUS[2].code}-source`,
    },
    tx,
  );

  // destination plan: 60개 전량 입고 → item.status 'confirmed'.
  await inboundService.receiveFromPlan(
    {
      planItemId: destinationItem.id,
      quantity: 60,
      locationId: SEED_IDS.locBucheonReceiving,
      idempotencyKey: `dev-seed-inbound-receive-${SEED_SKUS[2].code}-destination`,
    },
    tx,
  );

  // plan(헤더) 레벨 status 는 도메인 어디에서도 건드리지 않는 순수 분류 필드다 — 품목의
  // receivedQty/status 와 달리 재고 정합이 걸린 전이가 아니라 마스터 데이터 갱신이다
  // (createInboundPlanFromPO/receiveFromPlan 모두 plan.status 를 절대 바꾸지 않는다).
  // Phase 2 화면이 pending/receiving/confirmed 세 갈래를 다 보도록 여기서 직접 갱신한다.
  await tx
    .update(wmsTables.inboundPlans)
    .set({ status: 'receiving' })
    .where(eq(wmsTables.inboundPlans.id, sourcePlan.id));

  await tx
    .update(wmsTables.inboundPlans)
    .set({ status: 'confirmed' })
    .where(eq(wmsTables.inboundPlans.id, destinationPlan.id));
}
