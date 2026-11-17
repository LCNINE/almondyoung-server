import type { StoreProduct } from "@medusajs/types"
import { describe, expect, it } from "vitest"
import { splitClassTitle, toClassRow } from "./class-list-data"

const classProduct = (title: string, categoryHandles: string[] = []) =>
  ({
    id: title,
    handle: "h",
    title,
    thumbnail: "f",
    metadata: {},
    categories: categoryHandles.map((handle) => ({ handle })),
    variants: [
      {
        id: "v",
        manage_inventory: false,
        calculated_price: {
          calculated_amount: 150000,
          original_amount: 150000,
          currency_code: "krw",
        },
      },
    ],
  }) as unknown as StoreProduct

describe("splitClassTitle", () => {
  it("앞 [지역] 말머리를 떼어 낸다", () => {
    expect(splitClassTitle("[서울 잠실] 속눈썹펌 원데이")).toEqual({
      region: "서울 잠실",
      name: "속눈썹펌 원데이",
    })
  })

  it("말머리가 없으면 지역은 빈칸", () => {
    expect(splitClassTitle("속눈썹 수강")).toEqual({
      region: "",
      name: "속눈썹 수강",
    })
  })
})

describe("toClassRow", () => {
  it("지역 자식 카테고리로 탭을 정한다", () => {
    expect(
      toClassRow(classProduct("[인천 부평] 반영구", ["cafe24-cat-173"]), false)
        ?.tabs
    ).toEqual(["capital"])
  })

  it("카테고리가 없어도 말머리 지역어로 탭을 정한다", () => {
    expect(toClassRow(classProduct("[천안] 피어싱"), false)?.tabs).toEqual([
      "chungcheong",
    ])
    expect(toClassRow(classProduct("[마포] 속눈썹"), false)?.tabs).toEqual([
      "seoul",
    ])
  })

  it("어느 탭에도 안 들면 전체에서만 보인다", () => {
    expect(toClassRow(classProduct("[제주] 네일"), false)?.tabs).toEqual([])
  })
})
