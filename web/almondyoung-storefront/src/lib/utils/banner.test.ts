import { describe, expect, it } from "vitest"

import { getActiveBanners, isBannerGroupVisible } from "./banner"
import type { BannerDto } from "../types/dto/pim"

const banner = (over: Partial<BannerDto> = {}): BannerDto =>
  ({
    id: "b1",
    bannerGroupId: "g1",
    title: "배너",
    description: null,
    pcImageFileId: "pc",
    mobileImageFileId: "mo",
    linkUrl: null,
    linkedProductMasterIds: null,
    displayStartAt: null,
    displayEndAt: null,
    isActive: true,
    sortOrder: 0,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as BannerDto

describe("isBannerGroupVisible", () => {
  it("그룹이 비활성이면 안에 활성 배너가 있어도 노출하지 않는다", () => {
    expect(isBannerGroupVisible({ isActive: false, deletedAt: null })).toBe(false)
  })

  it("삭제된 그룹은 노출하지 않는다", () => {
    expect(
      isBannerGroupVisible({ isActive: true, deletedAt: "2026-01-01T00:00:00.000Z" })
    ).toBe(false)
  })

  it("그룹이 없으면 노출하지 않는다", () => {
    expect(isBannerGroupVisible(null)).toBe(false)
    expect(isBannerGroupVisible(undefined)).toBe(false)
  })

  it("활성이고 살아있으면 노출한다", () => {
    expect(isBannerGroupVisible({ isActive: true, deletedAt: null })).toBe(true)
  })
})

describe("getActiveBanners", () => {
  it("비활성 배너는 제외한다", () => {
    expect(getActiveBanners([banner({ isActive: false })])).toHaveLength(0)
  })

  it("노출 기간이 지난 배너는 제외한다", () => {
    expect(
      getActiveBanners([banner({ displayEndAt: "2020-01-01T00:00:00.000Z" })])
    ).toHaveLength(0)
  })

  it("sortOrder 순으로 정렬한다", () => {
    const result = getActiveBanners([
      banner({ id: "b2", sortOrder: 1 }),
      banner({ id: "b1", sortOrder: -1 }),
    ])
    expect(result.map((b) => b.id)).toEqual(["b1", "b2"])
  })
})
