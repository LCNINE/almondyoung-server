/**
 * 카탈로그 조회가 전부 함께 다는 방문자 무관 태그. 백엔드가 지목할 수 있는 유일한 태그라,
 * 상품이 바뀌면 `/api/revalidate` 가 이걸로 전역 무효화한다.
 *
 * 상세는 `product-{handle}` 을 하나 더 달아 그 상품만 정밀하게 걷어낼 수 있다.
 */
export const PRODUCT_LIST_TAG = "products"
