import { describe, expect, it } from "vitest"
import { classifyUrl } from "./url-policy"

const HOSTS = ["almondyoung.com", "auth.almondyoung.com"]

describe("classifyUrl", () => {
  it("등록된 호스트는 internal 이다", () => {
    expect(classifyUrl("https://almondyoung.com/kr/cart", HOSTS)).toBe("internal")
  })

  it("서브도메인이라도 목록에 있으면 internal 이다", () => {
    expect(classifyUrl("https://auth.almondyoung.com/oauth/authorize", HOSTS)).toBe("internal")
  })

  it("목록에 없는 호스트는 external 이다", () => {
    expect(classifyUrl("https://pay.toss.im/checkout", HOSTS)).toBe("external")
  })

  it("목록에 없는 서브도메인은 external 이다", () => {
    expect(classifyUrl("https://blog.almondyoung.com.evil.com/", HOSTS)).toBe("external")
  })

  it("파싱 불가 URL 은 external 로 처리한다", () => {
    expect(classifyUrl("not a url", HOSTS)).toBe("external")
  })

  it("http/https 가 아닌 스킴은 external 이다", () => {
    expect(classifyUrl("intent://scan/#Intent;scheme=zxing;end", HOSTS)).toBe("external")
  })
})
