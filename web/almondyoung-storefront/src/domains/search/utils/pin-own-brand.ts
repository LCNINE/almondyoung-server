export const OWN_BRAND = "노몬드 NOMOND"

// 1위 대비 이 비율 미만이면 끼우지 않는다. "호일" 검색에 자모 fuzzy 로 걸린
// "노몬드 클리닉 오일"(1위의 0.4%) 같은 엉뚱한 상품을 막는다.
export const PIN_SCORE_RATIO = 0.3

// 「미니배너」 카테고리 — 시술실에 세워두는 5천원짜리 홍보용 거치대 배너다. 상품명에
// 「색소」「영양제」가 들어가 있어서 그 검색어에 높게 걸리는데, 대체재로 추천하면 안 된다
// (2026-09-01 라이브 기준 "색소" 검색에서 노몬드 색소 에멀젼과 11% 차이까지 붙었다).
// 상품 19개짜리 전용 카테고리라 이름 매칭 대신 이걸로 거른다.
export const PIN_EXCLUDED_CATEGORY_IDS = ["758a3ab4-8c92-42f7-99ed-d13317ca906e"]

// 자사 상품 후보를 몇 개 받아볼지 — 응답 순서가 관련도 점수 순서와 달라서(벡터 검색과
// RRF 로 섞인다) 몇 개 받아 그중 최고점을 고른다.
export const PIN_CANDIDATE_SIZE = 5

// 1위가 아닐 때 끼워 넣기 시작하는 자리 (0-based → 2위)
const PIN_AT = 1

// 몇 개까지 끼울지 — 블랙/투명처럼 색만 다른 자매 상품을 목록에서 바로 고르게 한다.
export const PIN_LIMIT = 2

/**
 * 자사 상품이 이미 1위면 그대로 두고, 아니면 2위부터 끌어올린다.
 *
 * 호출 측이 1페이지에서만 pinnedIds 를 채운다 (search-results.ts). 페이지마다
 * 따로 계산하면 2페이지의 1위 점수가 낮아 관련도 하한을 쉽게 통과해버려서,
 * 1페이지에 고정한 적도 없는 상품을 2페이지에서 걷어내 «원래 있어야 할 결과»를
 * 지워버린다.
 *
 * ponytail: 고정한 상품이 자기 원래 순위(예: 3페이지)에도 한 번 더 나올 수 있다.
 * 없애려면 페이지마다 1페이지 기준을 다시 계산해야 하는데 — 매 페이지 검색 호출이
 * 한 번씩 늘고, 잘못 계산하면 상품이 아예 사라진다. 중복 노출이 유실보다 낫다.
 */
export function pinOwnBrand(masterIds: string[], pinnedIds: string[]): string[] {
  if (pinnedIds.length === 0) return masterIds
  if (pinnedIds.includes(masterIds[0])) return masterIds

  const rest = masterIds.filter((id) => !pinnedIds.includes(id))
  rest.splice(PIN_AT, 0, ...pinnedIds)
  return rest
}
