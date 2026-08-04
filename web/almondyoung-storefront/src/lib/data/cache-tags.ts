/**
 * 목록 fetch 의 캐시 태그는 `${tag}-${_medusa_cache_id}` 형태로 방문자별이라
 * 백엔드가 지목할 수 없다. 모든 목록이 이 태그를 함께 달아, 상품이 바뀌면
 * `/api/revalidate` 가 전역으로 걷어낼 수 있게 한다.
 */
export const PRODUCT_LIST_TAG = "products"
