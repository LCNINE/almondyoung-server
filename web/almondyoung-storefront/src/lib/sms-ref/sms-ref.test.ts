import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api/api", () => ({ api: vi.fn() }))

import { api } from "@/lib/api/api"
import { recordSmsRef, settleSmsRef, SMS_REF_COOKIE } from "./sms-ref"

const apiMock = vi.mocked(api)

beforeEach(() => {
  apiMock.mockReset()
})

describe("recordSmsRef", () => {
  it("받은 토큰을 Authorization 에 직접 실어 연결을 기록한다", async () => {
    apiMock.mockResolvedValueOnce(undefined)

    await expect(recordSmsRef("AbCd_123", "tok", "login")).resolves.toBe(true)

    expect(apiMock).toHaveBeenCalledTimes(1)
    const [service, path, options] = apiMock.mock.calls[0]
    expect(service).toBe("notification")
    expect(path).toBe("/sms-gate/links/AbCd_123/attributions")
    expect(options).toMatchObject({
      method: "POST",
      body: { kind: "login" },
      withAuth: false,
      timeout: 3000,
      headers: { Authorization: "Bearer tok" },
    })
  })

  it("기록이 실패해도 던지지 않고 false", async () => {
    apiMock.mockRejectedValueOnce(new Error("boom"))

    await expect(recordSmsRef("AbCd_123", "tok", "login")).resolves.toBe(false)
  })
})

describe("settleSmsRef", () => {
  const requestWith = (cookie?: string) =>
    new NextRequest("http://localhost:8000/kr", cookie ? { headers: { cookie } } : undefined)

  it("유효한 sms_ref 가 있으면 기록하고 쿠키를 지운다", async () => {
    apiMock.mockResolvedValueOnce(undefined)
    const response = NextResponse.next()

    await settleSmsRef(requestWith(`${SMS_REF_COOKIE}=AbCd_123`), response, "tok", "clicked_signed_in")

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock.mock.calls[0][2]).toMatchObject({ body: { kind: "clicked_signed_in" } })
    expect(response.cookies.get(SMS_REF_COOKIE)?.value).toBe("")
  })

  it("기록이 실패해도 쿠키는 지운다", async () => {
    apiMock.mockRejectedValueOnce(new Error("404"))
    const response = NextResponse.next()

    await settleSmsRef(requestWith(`${SMS_REF_COOKIE}=AbCd_123`), response, "tok", "login")

    expect(response.cookies.get(SMS_REF_COOKIE)?.value).toBe("")
  })

  it("형식이 틀린 sms_ref 나 쿠키가 없으면 아무것도 안 부른다", async () => {
    await settleSmsRef(requestWith(`${SMS_REF_COOKIE}=bad`), NextResponse.next(), "tok", "login")
    await settleSmsRef(requestWith(), NextResponse.next(), "tok", "login")

    expect(apiMock).not.toHaveBeenCalled()
  })
})
