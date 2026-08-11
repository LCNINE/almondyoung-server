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

  it("멤버십 회원은 개인 토큰 대신 세그먼트를 보낸다", () => {
    const request = buildCatalogRequest(auth, true, "secret")

    expect(request.headers).toEqual({
      [CATALOG_SEGMENT_HEADER]: "mem",
      [CATALOG_SEGMENT_KEY_HEADER]: "secret",
    })
    expect(request.headers).not.toHaveProperty("authorization")
    expect(request.isPersonalized).toBe(false)
  })

  it("로그인했어도 멤버십이 아니면 비로그인과 같은 항목을 쓴다", () => {
    const loggedIn = buildCatalogRequest(auth, false, "secret")
    const anonymous = buildCatalogRequest(null, false, "secret")

    expect(loggedIn).toEqual(anonymous)
    expect(loggedIn.headers).toEqual({})
    expect(loggedIn.isPersonalized).toBe(false)
  })

  it("멤버십이 아니면 시크릿 없이도 캐시한다", () => {
    expect(buildCatalogRequest(auth, false, undefined)).toEqual({
      headers: {},
      isPersonalized: false,
    })
  })

  it("멤버십 회원과 비회원은 캐시 항목이 갈린다", () => {
    const member = buildCatalogRequest(auth, true, "secret")
    const regular = buildCatalogRequest(auth, false, "secret")

    expect(member.headers).not.toEqual(regular.headers)
  })

  it("서로 다른 멤버십 회원은 같은 헤더를 쓴다", () => {
    const one = buildCatalogRequest({ authorization: "Bearer a" }, true, "s")
    const two = buildCatalogRequest({ authorization: "Bearer b" }, true, "s")

    expect(one.headers).toEqual(two.headers)
  })

  it("멤버십 회원인데 시크릿이 없으면 토큰을 쓰고 캐시하지 않는다", () => {
    const request = buildCatalogRequest(auth, true, undefined)

    expect(request.headers).toEqual(auth)
    expect(request.isPersonalized).toBe(true)
  })
})
