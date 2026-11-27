import { expect, it } from "vitest"

import { resolveCountryCode } from "./use-country-code"

it("경로 파라미터가 있으면 그것을 쓴다", () => {
  expect(resolveCountryCode("jp", "/jp/products/x")).toBe("jp")
})

it("루트 404 처럼 파라미터가 없으면 주소 첫 마디를 쓴다", () => {
  expect(resolveCountryCode(undefined, "/kr/article/review/4/60694/page/8")).toBe("kr")
})

it("첫 마디가 국가코드 모양이 아니면 기본 지역을 쓴다", () => {
  expect(resolveCountryCode(undefined, "/article/review")).toBe("kr")
  expect(resolveCountryCode(undefined, null)).toBe("kr")
})
