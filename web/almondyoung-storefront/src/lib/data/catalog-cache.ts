/** 카테고리 트리 fetch 의 공유 태그. */
export const CATEGORY_TREE_TAG = "categories"

/**
 * 카탈로그 fetch 의 시간 만료 한도. 가격·판매중단·품절 전환은 channel-adapter 가
 * `/api/revalidate` 로 즉시 걷어내므로, 시간 만료는 그 훅이 유실됐을 때의 백스톱이다.
 */
export const CATALOG_REVALIDATE_SECONDS = 60 * 60 * 24

export type CatalogFetchCacheOptions =
  | { cache: "no-store" }
  | { next: { tags: string[]; revalidate: number } }

/**
 * 개인화된 응답은 공유 캐시에 넣지 않는다.
 *
 * Next 의 fetch 캐시는 전 방문자가 공유한다. 인증 헤더를 실어 받은 응답은 회원가가
 * 담겨 있으므로 캐시 키 분리에 기대지 않고 아예 저장하지 않는다.
 */
export const buildCatalogCacheOptions = (
  isPersonalized: boolean,
  tags: string[]
): CatalogFetchCacheOptions =>
  isPersonalized
    ? { cache: "no-store" }
    : { next: { tags, revalidate: CATALOG_REVALIDATE_SECONDS } }
