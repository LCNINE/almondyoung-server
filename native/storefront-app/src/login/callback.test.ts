import { describe, expect, it } from "vitest"
import { buildWebviewCallbackUrl, parseOidcCallbackParams } from "./callback"

describe("parseOidcCallbackParams", () => {
  it("커스텀 스킴 콜백에서 code 와 state 를 뽑는다", () => {
    expect(parseOidcCallbackParams("almondyoung://callback/oidc?code=abc&state=xyz"))
      .toEqual({ code: "abc", state: "xyz" })
  })

  it("code 가 없으면 null 이다", () => {
    expect(parseOidcCallbackParams("almondyoung://callback/oidc?state=xyz")).toBeNull()
  })

  it("state 가 없으면 null 이다", () => {
    expect(parseOidcCallbackParams("almondyoung://callback/oidc?code=abc")).toBeNull()
  })

  it("IdP 가 error 를 실어 보내면 null 이다", () => {
    expect(
      parseOidcCallbackParams("almondyoung://callback/oidc?error=access_denied"),
    ).toBeNull()
  })

  it("파싱 불가 문자열은 null 이다", () => {
    expect(parseOidcCallbackParams("garbage")).toBeNull()
  })
})

describe("buildWebviewCallbackUrl", () => {
  it("기존 storefront 콜백 라우트 URL 을 만든다", () => {
    expect(
      buildWebviewCallbackUrl({
        origin: "https://almondyoung.com",
        countryCode: "kr",
        code: "abc",
        state: "xyz",
      }),
    ).toBe("https://almondyoung.com/kr/callback/oidc?code=abc&state=xyz")
  })

  it("code 와 state 를 URL 인코딩한다", () => {
    expect(
      buildWebviewCallbackUrl({
        origin: "https://almondyoung.com",
        countryCode: "kr",
        code: "a b+c",
        state: "x/y",
      }),
    ).toBe("https://almondyoung.com/kr/callback/oidc?code=a+b%2Bc&state=x%2Fy")
  })

  it("redirectTo 가 없으면 기존 동작과 동일하다 (redirect_to 파라미터 없음)", () => {
    expect(
      buildWebviewCallbackUrl({
        origin: "https://almondyoung.com",
        countryCode: "kr",
        code: "abc",
        state: "xyz",
      }),
    ).toBe("https://almondyoung.com/kr/callback/oidc?code=abc&state=xyz")
  })

  it("redirectTo 가 있으면 redirect_to 로 인코딩해 담는다", () => {
    expect(
      buildWebviewCallbackUrl({
        origin: "https://almondyoung.com",
        countryCode: "kr",
        code: "abc",
        state: "xyz",
        redirectTo: "/products/abc?x=1",
      }),
    ).toBe(
      "https://almondyoung.com/kr/callback/oidc?code=abc&state=xyz&redirect_to=%2Fproducts%2Fabc%3Fx%3D1",
    )
  })
})
