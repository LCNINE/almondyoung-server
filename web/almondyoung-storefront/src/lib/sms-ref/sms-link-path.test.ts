import { describe, expect, it } from "vitest"
import { smsLinkRewritePath } from "./sms-link-path"

describe("smsLinkRewritePath", () => {
  it("/r/<8자 코드> 는 코드를 경로에 실은 API 라우트로", () => {
    expect(smsLinkRewritePath("/r/AbCd_123")).toBe("/api/sms-link/AbCd_123")
  })

  it.each(["/r/short", "/r/AbCd_123/x", "/kr/r/AbCd_123", "/r/AbCd 123"])("%p 는 추적 링크가 아니다", (path) => {
    expect(smsLinkRewritePath(path)).toBeNull()
  })
})
