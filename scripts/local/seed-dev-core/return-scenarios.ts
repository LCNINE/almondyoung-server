import { and, eq, inArray } from 'drizzle-orm';
import type { CustomerReturnReason } from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { CustomerReturnManager } from '../../../apps/core/src/modules/sales-order/customer-return/customer-return.manager';
import { seedDeliveredLine } from '../../../apps/core/src/modules/sales-order/line-quantities/__support__/claim-facts.fixtures';
import { SEED_IDS } from './constants';
import { SCENARIO_SKUS, rack, seededId } from './outbound-scenarios';

// 이 파일이 쓰는 UUID 접두(019d0011) 의 전체 할당 목록은 constants.ts 상단 레지스트리 참고.
const VARIANT_ID_PREFIX = '019d0011';

type Component = [skuNo: number, qtyPerUnit: number];

/**
 * 반품 하나 = 스테이션 F7 반품의 길 하나. 상품은 출고 시나리오 상품(바코드 88099900000NN)이다.
 * 주문 줄 하나씩 — `seedDeliveredLine` 이 주문마다 줄 하나를 만든다(«같은 SKU 두 줄»은 앱·core 스펙이 덮는다).
 * 고객명은 시나리오 이름이다 — 목록은 뒤 절반을 가려 «변심**» 처럼 보이고, 검색은 원문 부분 일치로 된다.
 * 표: docs/local-dev.md «반품 시나리오».
 */
const SCENARIO_RETURNS: Array<{
  purpose: string;
  customer: string;
  productName: string;
  quantity: number;
  components: Component[];
  reason: CustomerReturnReason;
  feeBearer: 'customer' | 'seller';
}> = [
  {
    purpose: '소포 세기 → 검수(양품 1·불량 1) → 환불 요청',
    customer: '변심반품',
    productName: SCENARIO_SKUS[0].name,
    quantity: 2,
    components: [[1, 1]],
    reason: 'change_of_mind',
    feeBearer: 'customer',
  },
  {
    purpose: '하나만 세면 «덜 옴»',
    customer: '덜옴반품',
    productName: SCENARIO_SKUS[1].name,
    quantity: 3,
    components: [[2, 1]],
    reason: 'defective',
    feeBearer: 'seller',
  },
  {
    purpose: '세트 구성품이 다른 SKU 항목 둘 · 보류 검수 → held',
    customer: '세트반품',
    productName: '헤어롤·앰플 홈케어 세트',
    quantity: 1,
    components: [
      [5, 2],
      [6, 1],
    ],
    reason: 'wrong_item',
    feeBearer: 'seller',
  },
];

/**
 * 부천이 배송완료한 주문 셋과 그 반품 예정 기록 셋(K8 PR7b N11) — Medusa 없이 F7 반품의 모든 길을 밟는다.
 * 배송완료 사슬은 core 통합 스펙의 `seedDeliveredLine`, 반품 기록은 실제 `CustomerReturnManager.recordRequested` 가 만든다.
 * 출고 시나리오(SCENARIO_SKUS) 뒤에 불러야 한다 — 그 상품을 쓴다.
 */
export async function seedReturnScenarios(intake: CustomerReturnManager, tx: DbTx): Promise<void> {
  // 도착·검수는 그 창고의 return_default 에서 상태만 바꾼다 — master-data.ts 가 만든다. ensureSystemLocations 는
  // 부르지 않는다(rework·transit 존 둘이 더 생겨 기본 존 표가 바뀐다). 없으면 화면에서야 알게 되므로 여기서 멈춘다.
  const [returnZone] = await tx
    .select({ id: wmsTables.locations.id })
    .from(wmsTables.locations)
    .where(
      and(
        eq(wmsTables.locations.warehouseId, SEED_IDS.warehouseBucheon),
        eq(wmsTables.locations.systemRole, 'return_default'),
      ),
    );
  if (!returnZone) throw new Error('[seed-dev-core] 부천에 return_default 위치가 없다 — master-data.ts 를 본다');

  for (const [index, scenario] of SCENARIO_RETURNS.entries()) {
    const seq = String(index + 1).padStart(4, '0');
    const channelOrderId = `DEV-RETURN-${seq}`;
    const channelOrderItemId = `${channelOrderId}-1`;
    const composition = scenario.components.map(([skuNo, qtyPerUnit]) => ({
      sku: SCENARIO_SKUS[skuNo - 1],
      qtyPerUnit,
    }));

    const line = await seedDeliveredLine(
      tx,
      { warehouseId: SEED_IDS.warehouseBucheon, skuId: composition[0].sku.id, holderId: SEED_IDS.holderPrimary },
      {
        quantity: scenario.quantity,
        composition: composition.map((c) => ({ skuId: c.sku.id, qtyPerUnit: c.qtyPerUnit })),
        parcels: [
          { qtyBySku: Object.fromEntries(composition.map((c) => [c.sku.id, c.qtyPerUnit * scenario.quantity])) },
        ],
      },
    );

    // 픽스처는 식별자를 무작위로 둔다 — 화면에 보이고 손으로 치는 칸은 결정론으로 덮는다(constants.ts 규약)
    await tx
      .update(wmsTables.salesOrders)
      .set({
        channelOrderId,
        customerName: scenario.customer,
        shippingAddress: {
          recipientName: scenario.customer,
          phone: '010-0000-0000',
          postalCode: '14547',
          roadAddress: '경기도 부천시 길주로 1',
          detailAddress: `반품 ${seq}호`,
        },
        orderDate: new Date('2026-07-20T00:00:00.000Z'),
      })
      .where(eq(wmsTables.salesOrders.id, line.salesOrderId));
    await tx
      .update(wmsTables.salesOrderLines)
      .set({
        variantId: seededId(VARIANT_ID_PREFIX, index),
        productName: scenario.productName,
        unitPrice: 10_000,
        channelOrderItemId,
        channelProductId: `DEV-RETURN-PRODUCT-${index + 1}`,
      })
      .where(eq(wmsTables.salesOrderLines.id, line.lineId));
    // 다 나간 FO 는 진행 파생(fulfillment-progress.service)이 completed 로 둔다 — 픽스처는 ready 로 남긴다
    await tx
      .update(wmsTables.fulfillmentOrders)
      .set({ status: 'completed', shippedAt: new Date() })
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, line.salesOrderId));

    // 픽스처는 소포마다 무작위 코드의 집품 존(SF-Z-…)을 부천에 하나씩 만든다 — 그 상품의 랙으로 돌리고 존은 지운다
    for (const parcel of line.parcels) {
      const sources = await tx
        .select({ sourceLocationId: wmsTables.dispatchAttemptSources.sourceLocationId })
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, parcel.dispatchAttemptId));
      for (const c of composition) {
        const shipmentLineId = parcel.shipmentLineIdBySku.get(c.sku.id);
        if (!shipmentLineId) throw new Error(`[seed-dev-core] ${channelOrderId} 소포에 ${c.sku.code} 줄이 없다`);
        await tx
          .update(wmsTables.dispatchAttemptSources)
          .set({ sourceLocationId: rack(c.sku.placements[0].rack).id })
          .where(
            and(
              eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, parcel.dispatchAttemptId),
              eq(wmsTables.dispatchAttemptSources.shipmentLineId, shipmentLineId),
            ),
          );
      }
      await tx.delete(wmsTables.locations).where(
        inArray(
          wmsTables.locations.id,
          sources.map((source) => source.sourceLocationId),
        ),
      );
    }

    // 고객 이벤트(SalesOrderClaimProgressed)는 Medusa 회원 주문(customer_id)만 적재된다 — 시드 주문엔 없어 그 행은 생기지 않는다
    await intake.recordRequested(
      {
        orderId: channelOrderId,
        salesChannel: 'medusa',
        externalOrderId: channelOrderId,
        returnId: `DEV-RETURN-RET-${seq}`,
        requestId: `DEV-RETURN-REQ-${seq}`,
        reason: scenario.reason,
        feeBearer: scenario.feeBearer,
        requestedBy: 'customer',
        // 목록은 같은 단계 안에서 요청 이른 순 — 표 순서대로 뜬다
        requestedAt: `2026-07-24T0${index + 1}:00:00.000Z`,
        items: [{ channelOrderItemId, quantity: scenario.quantity }],
      },
      tx,
    );
  }
}
