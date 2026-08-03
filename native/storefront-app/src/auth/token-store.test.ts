import { describe, expect, it, vi } from "vitest"
import { createTokenStore, isExpired, type StoredTokens } from "./token-store"

function fakeBackend(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItemAsync: vi.fn(async (k: string) => data[k] ?? null),
    setItemAsync: vi.fn(async (k: string, v: string) => {
      data[k] = v
    }),
    deleteItemAsync: vi.fn(async (k: string) => {
      delete data[k]
    }),
  }
}

const SAMPLE: StoredTokens = { accessToken: "a", refreshToken: "r", expiresAt: 1000 }

describe("createTokenStore", () => {
  it("쓴 값을 그대로 읽는다", async () => {
    const store = createTokenStore(fakeBackend())
    await store.write(SAMPLE)
    expect(await store.read()).toEqual(SAMPLE)
  })

  it("저장된 값이 없으면 null 이다", async () => {
    expect(await createTokenStore(fakeBackend()).read()).toBeNull()
  })

  it("손상된 JSON 은 null 로 처리한다", async () => {
    const store = createTokenStore(fakeBackend({ "almondyoung.tokens": "{{{" }))
    expect(await store.read()).toBeNull()
  })

  it("문법은 올바르지만 빈 객체면 null 로 처리한다", async () => {
    const store = createTokenStore(fakeBackend({ "almondyoung.tokens": "{}" }))
    expect(await store.read()).toBeNull()
  })

  it("expiresAt 이 없으면 null 로 처리한다", async () => {
    const store = createTokenStore(
      fakeBackend({
        "almondyoung.tokens": JSON.stringify({ accessToken: "a", refreshToken: "r" }),
      })
    )
    expect(await store.read()).toBeNull()
  })

  it("expiresAt 이 숫자가 아니면 null 로 처리한다", async () => {
    const store = createTokenStore(
      fakeBackend({
        "almondyoung.tokens": JSON.stringify({
          accessToken: "a",
          refreshToken: "r",
          expiresAt: "1000",
        }),
      })
    )
    expect(await store.read()).toBeNull()
  })

  it("clear 후에는 null 이다", async () => {
    const store = createTokenStore(fakeBackend())
    await store.write(SAMPLE)
    await store.clear()
    expect(await store.read()).toBeNull()
  })
})

describe("isExpired", () => {
  it("만료 시각 이후면 만료다", () => {
    expect(isExpired(SAMPLE, 1001, 0)).toBe(true)
  })

  it("여유 시간 안이면 만료로 본다", () => {
    expect(isExpired(SAMPLE, 900, 200)).toBe(true)
  })

  it("여유 시간 밖이면 유효하다", () => {
    expect(isExpired(SAMPLE, 500, 200)).toBe(false)
  })
})
