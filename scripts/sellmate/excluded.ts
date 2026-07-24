/**
 * 셀메이트 동기화에서 **영구 제외**할 상품.
 *
 * 여기 걸린 상품은 `import-products` / `sync-stock` 이 아예 건너뛴다. 재고를 맞추면 안 되는
 * (= 셀메이트 재고가 판매 가능 재고를 뜻하지 않는) 상품이라, 동기화하면 품절이 풀려서 팔린다.
 *
 * **런북 `docs/runbooks/selmate-stock-pipeline.md` §Ⓐ-0 과 같이 관리한다.**
 * 목록에 추가할 땐 이유와 날짜를 반드시 남길 것 — 나중에 "이건 왜 빠져 있지" 가 반드시 나온다.
 */

/** 상품일련번호(셀메이트 `상품일련번호`) 기준 제외. 옵션이 늘어도 따라오므로 이쪽을 우선 쓴다. */
export const EXCLUDED_PRODUCT_SERIALS: ReadonlyMap<string, string> = new Map([
  ['13248', 'akf쌍커풀테이프 — 재고동기화 금지, 품절 유지 (2026-07-23)'],
  ['13333', '미스티 래쉬 — 중국 소싱, 재고동기화 금지 + 품절 유지 (2026-07-23)'],
  // 씨엠 쌍커풀 테이프(카페코드 P0000EAZ)는 현재 셀메이트 export에 없어 상품일련번호를 모른다.
  // 셀메이트에 다시 잡히면 여기에 일련번호를 추가할 것. 지금은 아래 NAME_PATTERN이 안전망.
]);

/** 상품명 정규식 기준 제외. 상품일련번호가 바뀌거나 CSV 에 그 열이 없을 때의 안전망. */
export const EXCLUDED_NAME_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /akf\s*쌍커풀\s*테이프/i, reason: 'akf쌍커풀테이프 — 재고동기화 금지, 품절 유지 (2026-07-23)' },
  { pattern: /미스티\s*래쉬/, reason: '미스티 래쉬 — 중국 소싱, 재고동기화 금지 + 품절 유지 (2026-07-23)' },
  { pattern: /씨엠[\s\S]*쌍커풀[\s\S]*테이프/, reason: '씨엠 쌍커풀 테이프(P0000EAZ) — 재고동기화 금지 + 품절 유지, Medusa manage_inventory로 강제 (2026-07-24)' },
];

/**
 * 이 행을 동기화에서 빼야 하면 사유를, 아니면 null 을 돌려준다.
 * 두 기준 중 하나라도 걸리면 제외 — 한쪽 열이 비어 있어도 다른 쪽이 잡는다.
 */
export function excludedReason(productSerial: string, productName: string): string | null {
  const bySerial = EXCLUDED_PRODUCT_SERIALS.get(productSerial.trim());
  if (bySerial) return bySerial;
  for (const { pattern, reason } of EXCLUDED_NAME_PATTERNS) {
    if (pattern.test(productName)) return reason;
  }
  return null;
}

// 제외 판정이 조용히 깨지면 금지 상품이 다시 동기화되므로 로드 시점에 확인한다.
if (
  !excludedReason('13248', '') ||
  !excludedReason('', 'akf쌍커풀테이프') ||
  !excludedReason('13333', '') ||
  !excludedReason('', '미스티 래쉬') ||
  !excludedReason('', '초특가 씨엠 쌍커풀 테이프 티안나는 셀프 실쌍테 천사 쌍테') ||
  excludedReason('99999', '루가 래쉬 밍크모')
) {
  throw new Error('excludedReason 판정이 깨졌습니다');
}
