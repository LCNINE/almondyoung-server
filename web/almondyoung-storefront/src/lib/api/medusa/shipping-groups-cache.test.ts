import { describe, expect, it } from "vitest"

import {
  SHIPPING_GROUPS_REVALIDATE_SECONDS,
  buildShippingGroupsFetchOptions,
} from "./shipping-groups-cache"

describe("buildShippingGroupsFetchOptions", () => {
  it("revalidate 를 붙여 Data Cache 에 태운다", () => {
    // Next 15 의 fetch 기본값은 no-store 다. revalidate 가 빠지면 배송비 그룹 조회가
    // 루트 레이아웃에서 페이지뷰 1건당 Medusa 호출 1건으로 새어나간다.
    const options = buildShippingGroupsFetchOptions({})

    expect(options.revalidate).toBe(SHIPPING_GROUPS_REVALIDATE_SECONDS)
    expect(options.revalidate).toBeGreaterThan(0)
  })

  it("getCacheOptions 가 준 태그를 보존한다", () => {
    const options = buildShippingGroupsFetchOptions({ tags: ["fulfillment-abc"] })

    expect(options.tags).toEqual(["fulfillment-abc"])
    expect(options.revalidate).toBeGreaterThan(0)
  })

  it("태그가 없는 방문자(쿠키 미설정)도 캐시된다", () => {
    // getCacheTag 는 _medusa_cache_id 쿠키가 없으면 빈 문자열을 돌려주고
    // getCacheOptions 는 {} 를 반환한다. 그 경로에서도 캐시는 살아 있어야 한다.
    const options = buildShippingGroupsFetchOptions({})

    expect(options.tags).toBeUndefined()
    expect(options.revalidate).toBeGreaterThan(0)
  })
})
