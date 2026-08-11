import { describe, expect, it } from "vitest"
import {
  CATALOG_SEGMENT_HEADER,
  CATALOG_SEGMENT_KEY_HEADER,
  buildCatalogRequest,
} from "./catalog-segment"

const auth = { authorization: "Bearer jwt-for-one-person" }

describe("buildCatalogRequest", () => {
  it("비로그인은 헤더 없이 캐시한다", () => {
    expect(buildCatalogRequest(null, false, "secret")).toEqual({
      headers: {},
      isPersonalized: false,
    })
  })

  it("회원은 개인 토큰 대신 세그먼트를 보낸다", () => {
    const request = buildCatalogRequest(auth, true, "secret")

    expect(request.headers).toEqual({
      [CATALOG_SEGMENT_HEADER]: "mem",
      [CATALOG_SEGMENT_KEY_HEADER]: "secret",
    })
    expect(request.headers).not.toHaveProperty("authorization")
    expect(request.isPersonalized).toBe(false)
  })

  it("로그인했지만 멤버십이 아니면 비회원 세그먼트로 보낸다", () => {
    expect(buildCatalogRequest(auth, false, "secret").headers).toEqual({
      [CATALOG_SEGMENT_HEADER]: "reg",
      [CATALOG_SEGMENT_KEY_HEADER]: "secret",
    })
  })

  it("회원과 비회원은 서로 다른 헤더라 캐시 항목이 갈린다", () => {
    const member = buildCatalogRequest(auth, true, "secret")
    const regular = buildCatalogRequest(auth, false, "secret")

    expect(member.headers[CATALOG_SEGMENT_HEADER]).not.toBe(
      regular.headers[CATALOG_SEGMENT_HEADER]
    )
  })

  it("같은 세그먼트의 서로 다른 사람은 같은 헤더를 쓴다", () => {
    const one = buildCatalogRequest({ authorization: "Bearer a" }, true, "s")
    const two = buildCatalogRequest({ authorization: "Bearer b" }, true, "s")

    expect(one.headers).toEqual(two.headers)
  })

  it("시크릿이 없으면 세그먼트를 신뢰시킬 수 없으므로 토큰을 쓰고 캐시하지 않는다", () => {
    const request = buildCatalogRequest(auth, true, undefined)

    expect(request.headers).toEqual(auth)
    expect(request.isPersonalized).toBe(true)
  })
})
