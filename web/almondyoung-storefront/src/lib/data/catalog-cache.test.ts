import { describe, expect, it } from "vitest"
import {
  CATALOG_REVALIDATE_SECONDS,
  buildCatalogCacheOptions,
} from "./catalog-cache"

describe("buildCatalogCacheOptions", () => {
  it("개인화된 조회는 저장하지 않는다", () => {
    expect(buildCatalogCacheOptions(true, ["products"])).toEqual({
      cache: "no-store",
    })
  })

  it("개인화된 조회에는 캐시 태그를 달지 않는다", () => {
    const options = buildCatalogCacheOptions(true, ["products", "product-a"])

    expect(options).not.toHaveProperty("next")
  })

  it("비개인화 조회는 공유 태그로 캐시한다", () => {
    expect(buildCatalogCacheOptions(false, ["products", "product-a"])).toEqual({
      next: {
        tags: ["products", "product-a"],
        revalidate: CATALOG_REVALIDATE_SECONDS,
      },
    })
  })

  it("시간 만료는 무효화 훅 유실 대비 백스톱이라 하루를 넘기지 않는다", () => {
    expect(CATALOG_REVALIDATE_SECONDS).toBeLessThanOrEqual(60 * 60 * 24)
    expect(CATALOG_REVALIDATE_SECONDS).toBeGreaterThan(60 * 60)
  })
})
