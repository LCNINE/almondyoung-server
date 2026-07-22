/**
 * 결정론 규약(스펙 §7.7): 모든 식별자는 상수이거나 인덱스 파생이다.
 * 스캔 워크플로우를 개발하므로 바코드가 리셋마다 바뀌면 종이에 적어두고 쓸 수 없다.
 *
 * 창고 UUID 2개는 scripts/seeding/constants/uuids.ts 의 FIXED_UUIDS 와 동일한 값이라
 * 라이브/기존 시드와 창고 식별자가 어긋나지 않는다.
 *
 * **UUID 접두(첫 세그먼트) 레지스트리 — 이 파일이 SoT.** 새 시드 모듈을 추가할 때 여기 표에
 * 없는 다음 접두를 골라 쓰고, 이 목록에 한 줄 추가할 것. 각 모듈 파일의 주석은 이 레지스트리를
 * 가리키기만 하고 값을 다시 나열하지 않는다 (한쪽만 갱신되고 어긋나는 사고 방지).
 *
 *   019d0001 — constants.ts   SEED_IDS.warehouse*
 *   019d0002 — constants.ts   SEED_IDS.loc*(기본 존 8개)
 *   019d0003 — constants.ts   SEED_IDS.holder*
 *   019d0004 — constants.ts   SEED_IDS.deliveryProfile
 *   019d0005 — constants.ts   SEED_RACK_LOCATIONS (랙/빈 6개)
 *   019d0006 — constants.ts   SEED_SKUS (SKU 20개)
 *   019d0007 — orders.ts      variantIdFor (variant id 10개)
 *   019d0008 — shipments.ts   SEED_ACTOR (시드 작업자 신원)
 *   019d0009 — bulk.ts        bulkLocationId (벌크 로케이션 50개)
 *   019d000a — bulk.ts        bulkSkuId (벌크 SKU 300개)
 */
export const SEED_IDS = {
  warehouseBucheon: '019d0001-0001-7000-a000-000000000001',
  warehouseChina: '019d0001-0002-7000-a000-000000000002',

  locBucheonReceiving: '019d0002-0001-7000-a000-000000000001',
  locBucheonShipping: '019d0002-0002-7000-a000-000000000002',
  locBucheonDamage: '019d0002-0003-7000-a000-000000000003',
  locBucheonReturn: '019d0002-0004-7000-a000-000000000004',
  locChinaReceiving: '019d0002-0005-7000-a000-000000000005',
  locChinaShipping: '019d0002-0006-7000-a000-000000000006',
  locChinaDamage: '019d0002-0007-7000-a000-000000000007',
  locChinaReturn: '019d0002-0008-7000-a000-000000000008',

  holderPrimary: '019d0003-0001-7000-a000-000000000001',
  holderSecondary: '019d0003-0002-7000-a000-000000000002',

  deliveryProfile: '019d0004-0001-7000-a000-000000000001',
} as const;

/** 부천 일반 랙/빈 6개 — 이동·실사 대상. code 가 곧 라벨이다. */
export const SEED_RACK_LOCATIONS = Array.from({ length: 6 }, (_, index) => {
  // SEED_SKUS 와 동일한 이유로 padStart 를 쓴다 — 리터럴 템플릿(`000${n}` / `00000000000${n}`)은
  // 배열이 6개일 때만 우연히 유효한 UUID(8-4-4-4-12)가 되고, 9개를 넘기면 자릿수가 밀려 깨진다.
  const seq = String(index + 1).padStart(4, '0');
  return {
    id: `019d0005-${seq}-7000-a000-00000000${seq}`,
    code: `A-01-${String(index + 1).padStart(2, '0')}`,
    displayName: `A열 1단 ${index + 1}번`,
  };
});

/**
 * SKU 20건. 재고 배치는 stock.ts 가 index 로 결정한다:
 *   index 0~1  → 재고 0 (품절 경로)
 *   index 2~13 → 단일 로케이션
 *   index 14~19 → 다중 로케이션 분산
 * safetyStock 은 일부만 > 0 이라 재고조회의 '부족' 3-상태를 볼 수 있다.
 */
export const SEED_SKUS = Array.from({ length: 20 }, (_, index) => {
  const seq = String(index + 1).padStart(4, '0');
  return {
    // 브리프 원안은 마지막 세그먼트가 11자리(0000000+seq)라 유효한 UUID(8-4-4-4-12)가
    // 아니었다 — 8자리 zero-padding(00000000+seq)으로 12자리를 맞춰 postgres uuid 파싱을 통과시킨다.
    id: `019d0006-${seq}-7000-a000-00000000${seq}`,
    code: `DEV-SKU-${seq}`,
    name: `개발용 상품 ${seq}`,
    barcode: `8800000${seq}`,
    holderId: index % 2 === 0 ? SEED_IDS.holderPrimary : SEED_IDS.holderSecondary,
    safetyStock: index % 5 === 0 ? 10 : 0,
  };
});
