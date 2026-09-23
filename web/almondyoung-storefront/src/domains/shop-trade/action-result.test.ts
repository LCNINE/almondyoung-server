import { describe, expect, it } from "vitest"
import { ApiAuthError, HttpApiError } from "../../lib/api/api-error"
import { toActionFailure } from "./action-result"

describe("toActionFailure", () => {
  it("서버 에러는 상태와 서버 문구를 그대로 싣는다", () => {
    expect(
      toActionFailure(new HttpApiError("매물은 3건까지입니다", 409, "Conflict"))
    ).toEqual({ ok: false, status: 409, message: "매물은 3건까지입니다" })
  })

  it("로그인이 없으면 401", () => {
    expect(toActionFailure(new ApiAuthError())).toEqual({
      ok: false,
      status: 401,
      message: "UNAUTHORIZED",
    })
  })

  it("모르는 에러는 500 과 빈 문구 — 화면이 자기 문구를 쓴다", () => {
    expect(toActionFailure(new Error("boom"))).toEqual({
      ok: false,
      status: 500,
      message: "",
    })
  })
})
