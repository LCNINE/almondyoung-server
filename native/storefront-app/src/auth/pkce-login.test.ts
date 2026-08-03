import { afterEach, describe, expect, it, vi } from "vitest"
import type { StoredTokens, TokenStore } from "./token-store"

// pkce-login.ts 는 `../config/env` 의 appEnv 를 import 시점에 즉시 평가하고
// (authorize.test.ts 와 같은 이유로 mock 필요), `expo-auth-session` 을 top-level
// 에서 import 한다. expo-auth-session 은 react-native 를 타고 들어가는 실제
// 네이티브 패키지라 Node/vitest 환경에서 그대로 로드하면 Flow 문법 파싱에서
// 죽는다 (react-native/index.js 는 Flow 로 작성됨). 두 모듈 모두 vi.mock 으로
// 대체해 실제 패키지를 건드리지 않는다. vi.mock 은 호이스팅되므로 값도
// vi.hoisted 로 선언한다.
const mockAppEnv = vi.hoisted(() => ({
  storefrontOrigin: "https://almondyoung.test",
  medusaUrl: "https://medusa.almondyoung.test",
  medusaPublishableKey: "pk_test_dummy",
  authWebOrigin: "https://auth.almondyoung.test",
  appClientId: "almondyoung-android-app",
  userServiceUrl: "https://user.almondyoung.test",
  defaultCountryCode: "kr",
}))

vi.mock("../config/env", () => ({ appEnv: mockAppEnv }))
vi.mock("expo-auth-session", () => ({
  AuthRequest: class {},
  exchangeCodeAsync: vi.fn(),
  refreshAsync: vi.fn(),
  // 실제 expo-auth-session 의 TokenError 를 최소 재현한다 — 생성자가
  // `{ error, error_description? }` 를 받아 `.code` 에 `error` 값을 싣는다는
  // 계약만 pkce-login.ts 가 instanceof/`.code` 로 의존하므로 그 부분만 맞춘다.
  TokenError: class TokenError extends Error {
    code: string
    constructor(response: { error: string; error_description?: string }) {
      super(response.error_description ?? response.error)
      this.code = response.error
    }
  },
}))

import * as AuthSession from "expo-auth-session"
import { ensureFreshAccessToken, type RefreshFn } from "./pkce-login"

const NOW = 1_700_000_000_000

function fakeStore(initial: StoredTokens | null): TokenStore & {
  write: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
} {
  return {
    read: vi.fn(async () => initial),
    write: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("ensureFreshAccessToken", () => {
  it("만료 전 토큰은 갱신 없이 그대로 반환한다", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const store = fakeStore({
      accessToken: "still-valid",
      refreshToken: "r1",
      expiresAt: NOW + 60_000,
    })
    const refresh: RefreshFn = vi.fn()

    const result = await ensureFreshAccessToken(store, { refresh })

    expect(result).toBe("still-valid")
    expect(refresh).not.toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
  })

  it("만료된 토큰은 갱신하고 저장한 뒤 새 accessToken 을 반환한다", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const store = fakeStore({
      accessToken: "old",
      refreshToken: "r1",
      expiresAt: NOW - 1,
    })
    const refresh: RefreshFn = vi.fn(async () => ({
      accessToken: "new",
      refreshToken: "r2",
      expiresIn: 900,
    }))

    const result = await ensureFreshAccessToken(store, { refresh })

    expect(result).toBe("new")
    // authorize 는 auth-web, token 갱신은 user-service — 호스트가 다르다는 것이
    // 핵심 계약이므로 두 필드 모두 정확한 값으로 고정한다. `expect.any(String)`
    // 처럼 느슨하게 검증하면 두 호스트가 하나로 합쳐지는 회귀(브리프가 교정
    // 대상으로 지목한 바로 그 404 결함)를 이 테스트가 놓치게 된다.
    expect(refresh).toHaveBeenCalledWith(
      { clientId: mockAppEnv.appClientId, refreshToken: "r1" },
      {
        authorizationEndpoint: `${mockAppEnv.authWebOrigin}/oauth/authorize`,
        tokenEndpoint: `${mockAppEnv.userServiceUrl}/oauth/token`,
      },
    )
    expect(store.write).toHaveBeenCalledWith({
      accessToken: "new",
      refreshToken: "r2",
      expiresAt: NOW + 900_000,
    })
  })

  it("네트워크 오류(일반 Error)로 갱신이 실패하면 null 을 반환하되 store 는 그대로 둔다", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const store = fakeStore({
      accessToken: "old",
      refreshToken: "r1",
      expiresAt: NOW - 1,
    })
    const refresh: RefreshFn = vi.fn(async () => {
      throw new Error("network down")
    })

    const result = await ensureFreshAccessToken(store, { refresh })

    expect(result).toBeNull()
    expect(store.write).not.toHaveBeenCalled()
    // 일시적 네트워크 실패일 수 있으므로 세션을 지우면 안 된다 — 지우면
    // 비행기 모드에서 앱을 연 것만으로 사용자가 영구 로그아웃된다.
    expect(store.clear).not.toHaveBeenCalled()
  })

  it("invalid_grant 같은 TokenError(프로토콜 거부)로 갱신이 실패하면 store 를 비운다", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const store = fakeStore({
      accessToken: "old",
      refreshToken: "r1",
      expiresAt: NOW - 1,
    })
    const refresh: RefreshFn = vi.fn(async () => {
      throw new AuthSession.TokenError({ error: "invalid_grant" })
    })

    const result = await ensureFreshAccessToken(store, { refresh })

    expect(result).toBeNull()
    expect(store.write).not.toHaveBeenCalled()
    // 이 refreshToken 은 다시 시도해도 절대 성공하지 못한다 — 죽은 세션을 지워
    // 다음 콜드스타트가 "skip" 에 영원히 갇히지 않고 로그인을 다시 시도하게 한다.
    expect(store.clear).toHaveBeenCalledTimes(1)
  })

  it("갱신 응답에 accessToken 이 없으면 null 을 반환하고 store 를 비운다", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const store = fakeStore({
      accessToken: "old",
      refreshToken: "r1",
      expiresAt: NOW - 1,
    })
    const refresh: RefreshFn = vi.fn(async () => ({ accessToken: "" }))

    const result = await ensureFreshAccessToken(store, { refresh })

    expect(result).toBeNull()
    expect(store.write).not.toHaveBeenCalled()
    // 정상 응답이지만 이 accessToken 은 절대 쓸 수 없다 — 죽은 세션을 지운다.
    expect(store.clear).toHaveBeenCalledTimes(1)
  })

  it("갱신 응답에 refreshToken 이 없으면 기존 refreshToken 을 유지한다", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const store = fakeStore({
      accessToken: "old",
      refreshToken: "r1",
      expiresAt: NOW - 1,
    })
    const refresh: RefreshFn = vi.fn(async () => ({
      accessToken: "new",
      expiresIn: 900,
    }))

    const result = await ensureFreshAccessToken(store, { refresh })

    expect(result).toBe("new")
    expect(store.write).toHaveBeenCalledWith({
      accessToken: "new",
      refreshToken: "r1",
      expiresAt: NOW + 900_000,
    })
  })

  it("저장된 토큰이 없으면 null 을 반환한다", async () => {
    const store = fakeStore(null)
    const refresh: RefreshFn = vi.fn()

    const result = await ensureFreshAccessToken(store, { refresh })

    expect(result).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
  })
})
