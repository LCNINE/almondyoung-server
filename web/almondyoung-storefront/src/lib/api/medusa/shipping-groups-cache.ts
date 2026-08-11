/**
 * 배송비 그룹 조회의 캐시 정책.
 *
 * `shipping-groups.ts` 는 `"use server"` 라 async 함수만 export 할 수 있어서,
 * 순수 로직은 이 파일에 둔다(테스트 가능한 지점을 만들기 위함).
 */

/**
 * 배송비 그룹은 운영자가 가끔 바꾸는 전역 정책이라 방문자별로 다르지 않다.
 * `fulfillment` 태그를 무효화하는 코드는 현재 없으므로 TTL 이 유일한 갱신 경로다.
 * 5분이면 관리자 변경이 곧 반영되면서도 페이지뷰당 호출은 사실상 사라진다.
 */
export const SHIPPING_GROUPS_REVALIDATE_SECONDS = 300

type CacheOptions = { tags?: string[] }

/**
 * Next 15 의 fetch 기본값은 `no-store` 다. `next.tags` 만으로는 Data Cache 에 태워지지
 * 않으므로, revalidate 를 명시하지 않으면 이 조회가 **페이지뷰 1건당 Medusa 호출 1건**이 된다.
 * 루트 레이아웃(`app/layout.tsx`)에서 불리기 때문에 모든 페이지가 영향을 받는다.
 */
export function buildShippingGroupsFetchOptions(
  cacheOptions: CacheOptions
): CacheOptions & { revalidate: number } {
  return {
    ...cacheOptions,
    revalidate: SHIPPING_GROUPS_REVALIDATE_SECONDS,
  }
}
