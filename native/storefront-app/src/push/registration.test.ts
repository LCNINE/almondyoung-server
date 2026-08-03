import { describe, expect, it, vi } from "vitest"
import { buildRegistrationPayload, registerFcmToken } from "./registration"

describe("buildRegistrationPayload", () => {
  it("서버 DTO 형태로 맞춘다", () => {
    expect(
      buildRegistrationPayload({
        token: "fcm-abc",
        deviceId: "inst-1",
        deviceModel: "Pixel 8",
        deviceName: "내 폰",
      }),
    ).toEqual({
      token: "fcm-abc",
      platform: "android",
      deviceId: "inst-1",
      deviceModel: "Pixel 8",
      deviceName: "내 폰",
    })
  })

  it("선택 필드가 없으면 키를 넣지 않는다", () => {
    expect(buildRegistrationPayload({ token: "fcm-abc" })).toEqual({
      token: "fcm-abc",
      platform: "android",
    })
  })
})

describe("registerFcmToken", () => {
  it("Bearer 토큰과 함께 POST 한다", async () => {
    // vi.fn(impl) 은 impl 의 매개변수 시그니처로 mock.calls 의 타입을 추론한다.
    // 브리프의 `async () => ...` (매개변수 없음) 그대로면 mock.calls[0] 이 빈
    // 튜플 `[]` 로 추론되어 아래 `as [string, RequestInit]` 캐스트가
    // "충분히 겹치지 않는다"는 tsc 오류(TS2352)를 낸다. 실제 fetch 시그니처를
    // 매개변수로 명시해 추론을 맞춘다 — 런타임 동작은 동일하다.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 201 }))
    await registerFcmToken(
      { fetch: fetchMock as unknown as typeof fetch, baseUrl: "https://notif.test" },
      { accessToken: "at", payload: { token: "fcm-abc", platform: "android" } },
    )
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://notif.test/devices/fcm-token")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer at")
  })

  it("서버가 실패하면 throw 한다", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }))
    await expect(
      registerFcmToken(
        { fetch: fetchMock as unknown as typeof fetch, baseUrl: "https://notif.test" },
        { accessToken: "at", payload: { token: "fcm-abc", platform: "android" } },
      ),
    ).rejects.toThrow(/401/)
  })
})
