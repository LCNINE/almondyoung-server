/**
 * 목록 fetch 의 캐시 태그는 `${tag}-${_medusa_cache_id}` 형태로 방문자별이라
 * 백엔드가 지목할 수 없다. 모든 목록이 이 태그를 함께 달아, 상품이 바뀌면
 * `/api/revalidate` 가 전역으로 걷어낼 수 있게 한다.
 */
export const PRODUCT_LIST_TAG = "products"

/**
 * 카테고리 트리(`/store/product-categories`) 조회의 공용 태그.
 * 어드민에서 카테고리가 바뀌면 channel-adapter 가 `/api/revalidate` 로 이 태그를 쳐서
 * 즉시 반영한다. 방문자별 접미사가 없어야 백엔드가 지목할 수 있다.
 */
export const CATEGORY_TREE_TAG = "product-categories"

/**
 * 진행 중인 타임세일 조회의 공용 태그.
 * Medusa 크론이 세일 시작·종료 경계에서 `/api/revalidate` 로 이 태그를 친다.
 */
export const TIME_SALE_TAG = "time-sale"
