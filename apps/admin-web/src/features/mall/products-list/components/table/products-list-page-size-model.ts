export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;

/** URL 의 size 파라미터. 허용값이 아니면 기본값으로 떨어진다 — 손으로 고친 URL 로 목록이 깨지지 않게. */
export function parsePageSize(raw: string | null | undefined): PageSize {
  const parsed = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as PageSize)
    : DEFAULT_PAGE_SIZE;
}

/**
 * '전체 선택' 을 열어도 되는 상태인지 판정하는 데 쓰는 "필터가 걸렸는가".
 * page/size/sort/order 는 보기 설정이지 필터가 아니다. datePreset 은 createdAt 과
 * 항상 같이 실리는 표시용 값이라 단독으로는 필터가 아니다.
 */
const FILTER_KEYS = [
  'q',
  'brand',
  'categoryId',
  'supplierId',
  'createdBy',
  'status',
  'stock',
  'createdAt',
] as const;

export function hasActiveFilter(params: URLSearchParams): boolean {
  return FILTER_KEYS.some((key) => (params.get(key) ?? '').length > 0);
}

/**
 * 현재 URL 의 필터 조건을 하나의 문자열로 압축한다. page/size/sort/order 는 포함하지
 * 않는다 — 페이지를 넘기거나 표시 개수를 바꾼 것은 "다른 조건에서 골랐다" 가 아니다.
 * 값이 여러 벌 실린 키는 첫 값만 본다(화면의 useQueryParams 도 get() 을 쓴다).
 */
export function filterSignature(params: URLSearchParams): string {
  return FILTER_KEYS.filter((key) => (params.get(key) ?? '').length > 0)
    .map((key) => `${key}=${params.get(key)}`)
    .join('&');
}

/** 필터가 바뀐 뒤에도 남아 있는 선택을 경고하기 위한 문구. 건수는 말하지 않는다 — 항목별 출처를 추적하지 않으므로 숫자를 대면 거짓말이 된다. */
const STALE_SELECTION_MESSAGE =
  '지금 화면의 필터와 다른 조건에서 고른 항목이 섞여 있습니다.';

/**
 * 선택에 "지금 화면과 다른 필터에서 고른 항목"이 섞여 있는지.
 * signatures = 선택이 담긴 시점들의 서명 목록(중복 제거됨).
 */
export function selectionStaleness(input: {
  signatures: string[];
  currentSignature: string;
  selectedCount: number;
}): { stale: boolean; message?: string } {
  if (input.selectedCount <= 0) return { stale: false };
  if (
    input.signatures.length === 1 &&
    input.signatures[0] === input.currentSignature
  ) {
    return { stale: false };
  }
  return { stale: true, message: STALE_SELECTION_MESSAGE };
}

/**
 * '전체 선택' 버튼을 열어도 되는지. 막는 사유는 **의심의 여지가 없는 것 두 가지뿐**이다:
 * 필터가 없거나, 결과가 0건이거나.
 *
 * 상한(5000건) 초과는 여기서 미리 막지 않는다 — total 은 목록 쿼리가 준 수인데, 그 수는
 * 카테고리 이너 조인의 팬아웃 때문에 부풀어 있다(한 상품이 상위·하위 카테고리 둘 다에
 * 매핑돼 있으면 두 번 세진다). 실제 4,000건인 카테고리가 6,000으로 보이면 버튼이
 * 영구히 잠기고, 하필 그 카테고리 필터가 MD 의 주 사용처다.
 *
 * 대신 눌러 보게 두고, 서버가 distinct 로 센 뒤 400 을 주면 그 메시지를 토스트로 보여준다.
 * 상한의 판정자는 중복을 제거한 수를 아는 쪽 하나뿐이고, 그건 서버다.
 */
export function canSelectAll(input: { hasFilter: boolean; total: number }): {
  ok: boolean;
  reason?: string;
} {
  if (!input.hasFilter) return { ok: false, reason: '필터를 먼저 걸어주세요.' };
  if (input.total <= 0) return { ok: false, reason: '선택할 상품이 없습니다.' };
  return { ok: true };
}
