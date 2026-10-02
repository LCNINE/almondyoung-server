import type { Wired } from '../../../apps/core/src/modules/fulfillment/services/__support__/logistics-wiring';
import { InventoryCommandService } from '../../../apps/core/src/modules/inventory/core/services/inventory-command.service';
import { ShipmentPlanningService } from '../../../apps/core/src/modules/fulfillment/services/shipment-planning.service';
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS, SEED_RACK_LOCATIONS } from './constants';
import { createOrderShipment, matchVariant } from './orders';
import { planEach } from './shipments';

// 이 파일이 쓰는 UUID 접두(019d000f, 019d0010) 의 전체 할당 목록은 constants.ts 상단 레지스트리 참고.
const SKU_ID_PREFIX = '019d000f';
const VARIANT_ID_PREFIX = '019d0010';

function seededId(prefix: string, index: number): string {
  const seq = String(index + 1).padStart(4, '0');
  return `${prefix}-${seq}-7000-a000-00000000${seq}`;
}

function rack(code: string) {
  const location = SEED_RACK_LOCATIONS.find((candidate) => candidate.code === code);
  if (!location) throw new Error(`[seed-dev-core] 랙 ${code} 이 SEED_RACK_LOCATIONS 에 없다`);
  return location;
}

/**
 * 출고 시나리오 상품. 재고 배치가 곧 시나리오다 — 결품 결과(채움·뺄 상품·빠진 박스)와 위치 나눔은 서버가
 * 재고에서 정하므로, 수량을 바꾸면 그 박스가 다른 경로로 간다. 표: docs/local-dev.md «출고 시나리오 박스».
 * 바코드는 13자리라 기본 시드(11자리)·송장(12자리)과 길이로도 갈린다.
 */
const SCENARIO_SKUS = [
  { name: '컬러크림 6N 자연갈색 80g', placements: [{ rack: 'A-01-01', qty: 30 }] },
  { name: '헤어클립 집게핀 블랙 10p', placements: [{ rack: 'A-01-02', qty: 30 }] },
  { name: '퍼머넌트 1제 웨이브 500ml', placements: [{ rack: 'A-01-03', qty: 30 }] },
  // 결품 → 채움: 결품 난 A-01-04 를 빼고도 A-01-06 에서 채울 수 있다.
  {
    name: '염색볼·브러시 세트',
    placements: [
      { rack: 'A-01-04', qty: 20 },
      { rack: 'A-01-06', qty: 10 },
    ],
  },
  // 위치 나눔: ×3 을 한 곳에서 못 채워 A-01-05 2 + A-01-06 1 로 배정된다.
  {
    name: '실리콘 헤어롤 대 6p',
    placements: [
      { rack: 'A-01-05', qty: 2 },
      { rack: 'A-01-06', qty: 2 },
    ],
  },
  // 결품 → 뺄 상품: 박스 몫(2)뿐이라 채울 곳이 없다.
  { name: '앰플 트리트먼트 30ml', placements: [{ rack: 'A-01-03', qty: 2 }] },
  // 결품 → 빠진 박스: 박스 몫(1)뿐, 한 줄짜리 박스.
  { name: '헤어 왁스 하드 80g', placements: [{ rack: 'A-01-05', qty: 1 }] },
  { name: '커트 가위 6인치', placements: [{ rack: 'A-01-02', qty: 10 }] },
].map((sku, index) => {
  const seq = String(index + 1).padStart(2, '0');
  return {
    ...sku,
    id: seededId(SKU_ID_PREFIX, index),
    variantId: seededId(VARIANT_ID_PREFIX, index),
    code: `DEV-BOX-SKU-${seq}`,
    barcode: `88099900000${seq}`,
  };
});

type ScenarioLine = [skuNo: number, qty: number];

/**
 * 박스 하나 = 스테이션 출고 검수의 경로 하나. 송장번호는 기본 박스 5개 뒤로 이어진다(900000000006~13).
 * 받는 분은 가짜 이름이다 — 화면은 가운데를 가려 보인다.
 */
const SCENARIO_BOXES: Array<{ purpose: string; recipient: Record<string, string>; lines: ScenarioLine[] }> = [
  {
    purpose: '검수 중 화면·정상 완료(여러 줄, ×3·×2)',
    recipient: {
      recipientName: '김서연',
      roadAddress: '경기도 부천시 길주로 210',
      detailAddress: '101동 1203호',
      deliveryNote: '문 앞에 놓아주세요',
    },
    lines: [
      [1, 1],
      [2, 3],
      [3, 2],
    ],
  },
  {
    purpose: '결품 위치 나눔(헤어롤 ×3 이 두 위치에)',
    recipient: { recipientName: '이준호', roadAddress: '서울특별시 구로구 디지털로 300', detailAddress: '12층' },
    lines: [
      [1, 1],
      [5, 3],
    ],
  },
  {
    purpose: '결품 → 채움 → 보충 대기',
    recipient: { recipientName: '박지민', roadAddress: '인천광역시 부평구 부평대로 88', detailAddress: '302호' },
    lines: [
      [2, 1],
      [4, 2],
    ],
  },
  {
    purpose: '결품 → 뺄 상품 → 되돌림 바구니',
    recipient: { recipientName: '최유나', roadAddress: '경기도 부천시 소사로 45', detailAddress: '2층' },
    lines: [
      [1, 2],
      [6, 2],
    ],
  },
  {
    purpose: '결품 → 빠진 박스(한 줄)',
    recipient: { recipientName: '정하늘', roadAddress: '서울특별시 마포구 월드컵로 12', detailAddress: '501호' },
    lines: [[7, 1]],
  },
  {
    purpose: '강제출고(F10)',
    recipient: { recipientName: '강도윤', roadAddress: '경기도 광명시 오리로 900', detailAddress: '1층 미용실' },
    lines: [
      [3, 1],
      [8, 2],
    ],
  },
  {
    purpose: '박스 빼기(F11)',
    recipient: { recipientName: '윤서아', roadAddress: '경기도 시흥시 정왕대로 33', detailAddress: '704호' },
    lines: [
      [2, 1],
      [8, 1],
    ],
  },
  {
    purpose: '검수 중 다른 송장 찍기·예비',
    recipient: { recipientName: '한지우', roadAddress: '서울특별시 강서구 공항대로 500', detailAddress: '8층' },
    lines: [
      [1, 1],
      [3, 1],
      [8, 1],
    ],
  },
];

/**
 * 출고 시나리오 상품·재고·주문을 만들고 planned 까지 올린다. 반환은 박스 순서의 shipment id —
 * 이어지는 `seedOutboundReady` 가 «한진 발급» 송장을 붙인다.
 */
export async function seedOutboundScenarios(
  wired: Wired,
  command: InventoryCommandService,
  planning: ShipmentPlanningService,
  tx: DbTx,
): Promise<string[]> {
  await tx.insert(wmsTables.skus).values(
    SCENARIO_SKUS.map((sku) => ({
      id: sku.id,
      holderId: SEED_IDS.holderPrimary,
      name: sku.name,
      code: sku.code,
      safetyStock: 0,
      deliveryProfileId: SEED_IDS.deliveryProfile,
    })),
  );
  await tx
    .insert(wmsTables.skuBarcodes)
    .values(SCENARIO_SKUS.map((sku) => ({ skuId: sku.id, barcode: sku.barcode, isPrimary: true })));

  for (const sku of SCENARIO_SKUS) {
    for (const [placementIndex, placement] of sku.placements.entries()) {
      // stock.ts 와 같은 이유로 receive 를 경유한다(원장·투영·판매가능수량이 함께 움직인다).
      await command.receive(
        {
          skuId: sku.id,
          toWarehouseId: SEED_IDS.warehouseBucheon,
          toLocationId: rack(placement.rack).id,
          quantity: placement.qty,
          reason: 'DEV-SEED',
          idempotencyKey: `dev-seed-receive-${sku.code}-${placementIndex}`,
        },
        tx,
      );
    }
    await matchVariant(tx, sku.variantId, sku.id);
  }

  const shipmentIds: string[] = [];
  for (const [index, box] of SCENARIO_BOXES.entries()) {
    const seq = String(index + 1).padStart(4, '0');
    shipmentIds.push(
      await createOrderShipment(
        wired,
        {
          channelOrderId: `DEV-BOX-${seq}`,
          channelItemIds: box.lines.map((_, lineIndex) => `DEV-BOX-${seq}-${lineIndex + 1}`),
          shippingAddress: { phone: '010-0000-0000', postalCode: '14547', ...box.recipient },
          lines: box.lines.map(([skuNo, qty]) => {
            const sku = SCENARIO_SKUS[skuNo - 1];
            return {
              productName: sku.name,
              variantId: sku.variantId,
              channelProductId: `DEV-BOX-PRODUCT-${skuNo}`,
              quantity: qty,
            };
          }),
        },
        tx,
      ),
    );
  }

  await planEach(planning, shipmentIds, 'dev-seed-box-plan', tx);
  return shipmentIds;
}
