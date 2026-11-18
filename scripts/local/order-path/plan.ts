/**
 * 주문 경로 시드(#1440)의 순수 판정 — HTTP 를 부르지 않는다. 호출부는 products.ts·checkout.ts·follow.ts,
 * 셸 쪽 짝은 preflight-e2e.sh 의 «주문 경로 상품» 판정(같은 이름 리터럴을 쓴다 — 여기가 정본).
 */

/** 시드가 갖추는 상품. 이름이 «찾는 열쇠»다 — productCode 는 HTTP 로 못 정한다(발행 때 AY-<n> 자동 발급). */
export const ORDER_PATH_PRODUCTS: readonly { name: string; options: readonly string[] }[] = [
  { name: '[E2E] 주문 경로 단일', options: [] },
  { name: '[E2E] 주문 경로 옵션', options: ['A', 'B'] },
];

/** 판매가(원). 기본 정보의 공급가·시장가는 판매가가 아니다 — 가격 규칙으로 따로 넣는다. */
export const ORDER_PATH_PRICE = 12000;

/** 부천 가용 재고를 이 수량까지 채운다. */
export const STOCK_TARGET = 100;

/** 부천 창고 안의 시드 전용 위치 — 열 `E2E`·랙 1 의 표준 빈 1칸(코드는 core 가 `열-랙-빈` 으로 만든다). */
export const ORDER_PATH_LOCATION = { columnName: 'E2E', rackNumber: 1 } as const;

/** SKU 를 다시 찾는 고정 보조 바코드. SKU 코드(P00001…)는 자동 발급이라 열쇠가 못 된다. */
export function skuBarcodeFor(productName: string, option: string | null): string {
  const short = productName.replace('[E2E] 주문 경로 ', '');
  return option ? `E2E-ORDER-${short}-${option}` : `E2E-ORDER-${short}`;
}

export interface MasterSummary {
  masterId: string;
  versionId: string;
  name: string;
  status: string;
}

/**
 * 검색(`q`)은 부분일치라 이름이 «정확히» 같은 행만 본다. 발행본(active)이 있으면 그걸, 없으면 초안을 고른다 —
 * 만들다 죽은 초안을 이어 써야 다시 돌려도 상품이 두 벌이 되지 않는다.
 */
export function pickExistingMaster(
  rows: MasterSummary[],
  name: string,
): { masterId: string; versionId: string; published: boolean } | null {
  const same = rows.filter((r) => r.name === name);
  const active = same.find((r) => r.status === 'active');
  if (active) return { masterId: active.masterId, versionId: active.versionId, published: true };
  const draft = same.find((r) => r.status === 'draft');
  if (draft) return { masterId: draft.masterId, versionId: draft.versionId, published: false };
  return null;
}

/** 모자란 만큼만. 이미 넘치면 0 — 줄이지 않는다. 요약이 없으면(재고 행 없음) 0 으로 본다. */
export function stockTopUpDelta(available: number | null, target: number): number {
  return Math.max(0, target - (available ?? 0));
}

export interface Recipient {
  firstName: string;
  lastName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2: string;
  province: string;
  city: string;
}

/**
 * 공개된 공공기관 실주소 — 한진 분류가 실제로 계산되는 주소(`seed-hanjin-samples.ts` 가 우체국 검색으로 확인한 값).
 * 도서산간은 배송비가 달라질 수 있어 넣지 않는다.
 */
const PUBLIC_ADDRESSES: readonly Pick<Recipient, 'postalCode' | 'address1' | 'province' | 'city'>[] = [
  { postalCode: '04524', address1: '서울특별시 중구 세종대로 110', province: '서울특별시', city: '중구' },
];

/**
 * core 는 «고객·배송 프로필·주소(상세주소 포함)»가 같은 상자를 합배송 묶음으로 본다(consolidation-options.ts).
 * 묶음이 되면 출고 준비에서 mergeable 로 빠지고 #1249 비상 도구가 뺀다 — 그래서 상세주소에 실행 스탬프와 순번을 넣는다.
 * 스탬프가 없으면 앞 실행의 안 나간 상자와 묶인다.
 */
export function recipientFor(stamp: string, seq: number): Recipient {
  const address = PUBLIC_ADDRESSES[(seq - 1) % PUBLIC_ADDRESSES.length];
  return {
    firstName: '검증',
    lastName: '주문',
    phone: '01000001440',
    ...address,
    address2: `E2E ${stamp}-${seq}`,
  };
}

export interface ShipmentView {
  id: string;
  status: string;
  warehouseId: string;
  totalQty: number;
  reservedQty: number;
}

export type WaitingStage =
  | 'no_sales_order'
  | 'quarantined'
  | 'matching_pending'
  | 'no_fulfillment_order'
  | 'no_shipment'
  | 'not_reserved'
  | 'wrong_warehouse';

export type BoxProgress = { kind: 'ready'; shipmentIds: string[] } | { kind: 'waiting'; stage: WaitingStage };

export interface BoxObservation {
  salesOrderId: string | null;
  quarantined: boolean;
  unmatchedLines: number;
  fulfillmentOrderId: string | null;
  shipments: ShipmentView[];
}

/** 주문이 «부천 상자 + 예약»까지 왔는지. 아니면 앞 단계부터 어디서 멈췄는지. */
export function judgeBox(obs: BoxObservation, bucheonWarehouseId: string): BoxProgress {
  if (!obs.salesOrderId) return { kind: 'waiting', stage: obs.quarantined ? 'quarantined' : 'no_sales_order' };
  if (obs.unmatchedLines > 0) return { kind: 'waiting', stage: 'matching_pending' };
  if (!obs.fulfillmentOrderId) return { kind: 'waiting', stage: 'no_fulfillment_order' };
  if (obs.shipments.length === 0) return { kind: 'waiting', stage: 'no_shipment' };
  if (obs.shipments.some((s) => s.warehouseId !== bucheonWarehouseId))
    return { kind: 'waiting', stage: 'wrong_warehouse' };
  if (obs.shipments.some((s) => s.status !== 'draft' || s.totalQty <= 0 || s.reservedQty !== s.totalQty)) {
    return { kind: 'waiting', stage: 'not_reserved' };
  }
  return { kind: 'ready', shipmentIds: obs.shipments.map((s) => s.id) };
}
