import { describe, expect, it, vi } from "vitest"

// authorize.ts 는 `../config/env` 의 appEnv 를 import 시점에 즉시 평가한다
// (env.ts 는 getter 가 아니라 모듈 top-level 에서 required() 를 바로 호출하는
// object literal 이다 — 값이 없으면 import 만 해도 throw 한다). 실제 EXPO_PUBLIC_*
// 값 없이 순수하게 테스트하기 위해, 커밋되는 .env 파일을 두는 대신 이 모듈을
// vi.mock 으로 통째로 대체해 고정된 더미 값을 주입한다. vi.mock 은 파일 내
// import 문보다 먼저 호이스팅되므로 아래 `import { requestMedusaAuthorizeUrl }`
// 시점에는 이미 이 모킹된 env 가 쓰인다. mock 값 자체도 vi.mock factory 와
// 함께 호이스팅되어야 참조 가능하므로 vi.hoisted 로 선언한다.
const mockAppEnv = vi.hoisted(() => ({
  storefrontOrigin: "https://almondyoung.test",
  medusaUrl: "https://medusa.almondyoung.test",
  medusaPublishableKey: "pk_test_dummy",
  authWebOrigin: "https://auth.almondyoung.test",
  appClientId: "almondyoung-android-app",
  defaultCountryCode: "kr",
}))

vi.mock("../config/env", () => ({ appEnv: mockAppEnv }))

import { requestMedusaAuthorizeUrl } from "./authorize"
import { WEBVIEW_LOGIN_REDIRECT } from "./callback"

function fakeFetch(response: {
  ok: boolean
  status: number
  json?: unknown
  text?: string
}) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: async () => response.json ?? {},
    text: async () => response.text ?? "",
  }) as unknown as typeof fetch
}

describe("requestMedusaAuthorizeUrl", () => {
  it("성공하면 응답의 location 을 반환한다", async () => {
    const fetch = fakeFetch({
      ok: true,
      status: 200,
      json: { location: "https://auth.almondyoung.test/oauth/authorize?foo=bar" },
    })

    const result = await requestMedusaAuthorizeUrl({ fetch })

    expect(result).toBe("https://auth.almondyoung.test/oauth/authorize?foo=bar")
  })

  it("medusaUrl·POST·publishable key 헤더·webview 콜백 스킴을 담은 body 로 요청한다", async () => {
    const fetch = fakeFetch({
      ok: true,
      status: 200,
      json: { location: "https://auth.almondyoung.test/oauth/authorize" },
    })

    await requestMedusaAuthorizeUrl({ fetch })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ]

    expect(url).toBe(
      `${mockAppEnv.medusaUrl}/auth/customer/user-service-sso`,
    )
    expect(init.method).toBe("POST")
    expect(init.headers["x-publishable-api-key"]).toBe(
      mockAppEnv.medusaPublishableKey,
    )
    expect(JSON.parse(init.body as string)).toEqual({
      callback_url: WEBVIEW_LOGIN_REDIRECT,
    })
  })

  it("응답이 ok 가 아니면 상태코드를 담아 throw 한다", async () => {
    const fetch = fakeFetch({ ok: false, status: 401, text: "unauthorized" })

    await expect(requestMedusaAuthorizeUrl({ fetch })).rejects.toThrow(/401/)
  })

  it("에러 응답 본문이 길어도 200자로 잘라서만 담는다", async () => {
    const longBody = "x".repeat(1000)
    const fetch = fakeFetch({ ok: false, status: 500, text: longBody })

    await expect(requestMedusaAuthorizeUrl({ fetch })).rejects.toThrow(
      // SplashGate 가 이 error.message 를 그대로 로그로 남긴다 — 임의 길이의
      // 업스트림 응답 본문이 무제한으로 새는 걸 막는 게 이 테스트의 목적이다.
      new RegExp(`^authorize 요청 실패: 500 x{200}$`),
    )
  })

  it("응답이 ok 인데 location 이 없으면 throw 한다", async () => {
    const fetch = fakeFetch({ ok: true, status: 200, json: {} })

    await expect(requestMedusaAuthorizeUrl({ fetch })).rejects.toThrow(
      /location/,
    )
  })
})
