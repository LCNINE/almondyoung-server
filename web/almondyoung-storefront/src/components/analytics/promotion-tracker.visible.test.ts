import { expect, it } from "vitest"
import { isPromotionVisible } from "./promotion-tracker"

const entry = (ratio: number, visibleHeight: number, viewport = 800) => ({
  isIntersecting: ratio > 0,
  intersectionRatio: ratio,
  intersectionRect: { height: visibleHeight },
  rootBounds: { height: viewport },
})

it("섹션의 절반이 보이면 노출이다", () => {
  expect(isPromotionVisible(entry(0.5, 200))).toBe(true)
  expect(isPromotionVisible(entry(0.4, 160))).toBe(false)
})

// 상품 40개짜리 더보기는 화면의 몇 배라 비율 50%에 구조적으로 닿지 않는다.
it("화면보다 긴 섹션은 화면 절반 이상을 채우면 노출이다", () => {
  expect(isPromotionVisible(entry(0.15, 400))).toBe(true)
  expect(isPromotionVisible(entry(0.1, 300))).toBe(false)
})

it("안 보이면 노출이 아니다", () => {
  expect(isPromotionVisible(entry(0, 0))).toBe(false)
})
