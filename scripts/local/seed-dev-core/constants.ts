/**
 * 결정론 규약(스펙 §7.7): 모든 식별자는 상수이거나 인덱스 파생이다.
 * 스캔 워크플로우를 개발하므로 바코드가 리셋마다 바뀌면 종이에 적어두고 쓸 수 없다.
 *
 * 창고 UUID 2개는 scripts/seeding/constants/uuids.ts 의 FIXED_UUIDS 와 동일한 값이라
 * 라이브/기존 시드와 창고 식별자가 어긋나지 않는다.
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
export const SEED_RACK_LOCATIONS = Array.from({ length: 6 }, (_, index) => ({
  id: `019d0005-000${index + 1}-7000-a000-00000000000${index + 1}`,
  code: `A-01-${String(index + 1).padStart(2, '0')}`,
  displayName: `A열 1단 ${index + 1}번`,
}));

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
