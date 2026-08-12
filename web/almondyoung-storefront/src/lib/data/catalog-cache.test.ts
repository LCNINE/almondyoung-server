import { beforeEach, describe, expect, it, vi } from "vitest"
import { CATALOG_SEGMENT_ECHO_FIELD } from "./catalog-segment"

vi.mock("server-only", () => ({}))

// 캐시 키를 눈으로 볼 수 있게 가로챈다. 실제 `unstable_cache` 는 keyParts 와 인자를
// 직렬화해 키를 만들므로, 여기서 모은 값이 곧 키에 들어가는 값이다.
const cacheCalls: Array<{ keyParts: string[]; options: unknown; args: unknown[] }> = []

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts: string[],
    options: unknown
  ) => {
    return (...args: unknown[]) => {
      cacheCalls.push({ keyParts, options, args })
      return fn(...args)
    }
  },
}))

// React `cache()` 는 요청 스코프다. 테스트에선 전역 store 로 흉내내고 렌더 경계마다 비운다.
vi.mock("react", () => ({
  cache: (fn: (...args: unknown[]) => unknown) => {
    return (...args: unknown[]) => {
      const store = ((globalThis as Record<string, unknown>).__reactCache ??=
        new Map()) as Map<unknown, unknown>
      if (!store.has(fn)) store.set(fn, fn(...args))
      return store.get(fn)
    }
  },
}))

/** 새 렌더(= 새 요청)를 시작한다. 요청 스코프 dedupe 를 비운다. */
const startNewRender = () => {
  ;(globalThis as Record<string, unknown>).__reactCache = new Map()
}

const fetchMock = vi.fn()
vi.mock("@/lib/config/medusa", () => ({
  sdk: { client: { fetch: (...args: unknown[]) => fetchMock(...args) } },
}))

const visitorMock = vi.fn()
vi.mock("./catalog-request", () => ({
  resolveCatalogVisitor: () => visitorMock(),
}))

// vi.mock 은 호이스팅되므로 정적 import 로도 위 모킹이 먼저 적용된다.
import { fetchCatalog } from "./catalog-cache"

const request = {
  path: "/store/products",
  query: { limit: 12, offset: 0, region_id: "reg_kr" },
  tags: ["products"],
}

const memberVisitor = {
  state: "mem" as const,
  authHeaders: { authorization: "Bearer member" },
}

const readHeaders = (call: unknown[]): Record<string, string> =>
  (call[1] as { headers: Record<string, string> }).headers

beforeEach(() => {
  cacheCalls.length = 0
  fetchMock.mockReset()
  visitorMock.mockReset()
  startNewRender()
  process.env.CATALOG_SEGMENT_SECRET = "secret"
})

describe("fetchCatalog — 캐시 키", () => {
  it("응답을 가르는 값이 전부 캐시 함수의 인자로 들어간다", async () => {
    visitorMock.mockResolvedValue(memberVisitor)
    fetchMock.mockResolvedValue({ products: [], [CATALOG_SEGMENT_ECHO_FIELD]: "mem" })

    await fetchCatalog(request)

    // 세그먼트·쿼리(region/수량/fields)·경로·태그가 전부 인자에 있어야 한다.
    // 하나라도 클로저로 새면 "응답은 바꾸는데 키엔 없는 값" 이 된다.
    expect(cacheCalls[0].args[0]).toEqual({ ...request, segment: "mem" })
  })

  it("세그먼트 헤더는 캐시 함수 안쪽에서 만들어진다", async () => {
    visitorMock.mockResolvedValue(memberVisitor)
    fetchMock.mockResolvedValue({ products: [], [CATALOG_SEGMENT_ECHO_FIELD]: "mem" })

    await fetchCatalog(request)

    // 헤더가 인자 바깥(클로저)에서 들어오면 키에 없는 채로 응답만 갈린다.
    expect(cacheCalls[0].args[0]).not.toHaveProperty("headers")
    expect(readHeaders(fetchMock.mock.calls[0])).toMatchObject({
      "x-catalog-segment": "mem",
    })
  })

  it("회원과 비회원은 캐시 인자가 갈린다", async () => {
    fetchMock.mockImplementation((_path, init: { headers: Record<string, string> }) =>
      Promise.resolve({
        [CATALOG_SEGMENT_ECHO_FIELD]: init.headers["x-catalog-segment"],
      })
    )

    visitorMock.mockResolvedValue(memberVisitor)
    await fetchCatalog(request)

    startNewRender()
    visitorMock.mockResolvedValue({ state: "reg", authHeaders: null })
    await fetchCatalog(request)

    expect(cacheCalls[0].args[0]).not.toEqual(cacheCalls[1].args[0])
  })

  it("서로 다른 회원은 같은 캐시 인자를 쓰고 토큰은 실리지 않는다", async () => {
    fetchMock.mockResolvedValue({ [CATALOG_SEGMENT_ECHO_FIELD]: "mem" })

    visitorMock.mockResolvedValue(memberVisitor)
    await fetchCatalog(request)

    startNewRender()
    visitorMock.mockResolvedValue({
      state: "mem",
      authHeaders: { authorization: "Bearer another-member" },
    })
    await fetchCatalog(request)

    expect(cacheCalls[0].args[0]).toEqual(cacheCalls[1].args[0])
    expect(readHeaders(fetchMock.mock.calls[0])).not.toHaveProperty("authorization")
    expect(readHeaders(fetchMock.mock.calls[1])).not.toHaveProperty("authorization")
  })

  it("태그 조합이 다르면 캐시 항목을 공유하지 않는다", async () => {
    visitorMock.mockResolvedValue(memberVisitor)
    fetchMock.mockResolvedValue({ [CATALOG_SEGMENT_ECHO_FIELD]: "mem" })

    await fetchCatalog(request)
    await fetchCatalog({ ...request, tags: ["products", "product-a"] })

    expect(cacheCalls[0].keyParts).not.toEqual(cacheCalls[1].keyParts)
  })
})

describe("fetchCatalog — 모름 상태", () => {
  it("멤버십을 모르면 토큰을 쓰고 캐시하지 않는다", async () => {
    visitorMock.mockResolvedValue({
      state: "unknown",
      authHeaders: { authorization: "Bearer who" },
    })
    fetchMock.mockResolvedValue({ products: [] })

    await fetchCatalog(request)

    expect(cacheCalls).toHaveLength(0)
    expect(readHeaders(fetchMock.mock.calls[0])).toEqual({
      authorization: "Bearer who",
    })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" })
  })

  it("시크릿이 없으면 세그먼트를 신뢰시킬 수 없어 캐시하지 않는다", async () => {
    delete process.env.CATALOG_SEGMENT_SECRET
    visitorMock.mockResolvedValue(memberVisitor)
    fetchMock.mockResolvedValue({ products: [] })

    await fetchCatalog(request)

    expect(cacheCalls).toHaveLength(0)
    expect(readHeaders(fetchMock.mock.calls[0])).toHaveProperty("authorization")
  })
})

describe("fetchCatalog — 에코 검증", () => {
  it("적용되지 않은 응답은 버리고 토큰으로 다시 받는다", async () => {
    visitorMock.mockResolvedValue(memberVisitor)
    // 그룹 id 누락 등으로 Medusa 가 mem 을 적용하지 못해 에코가 없는 상황.
    fetchMock
      .mockResolvedValueOnce({ products: ["비회원가"] })
      .mockResolvedValueOnce({ products: ["회원가"] })

    const result = await fetchCatalog<{ products: string[] }>(request)

    expect(result.products).toEqual(["회원가"])
    expect(readHeaders(fetchMock.mock.calls[1])).toHaveProperty("authorization")
  })

  it("mem 을 주장했는데 reg 가 적용돼도 폴백한다", async () => {
    visitorMock.mockResolvedValue(memberVisitor)
    fetchMock
      .mockResolvedValueOnce({
        products: ["비회원가"],
        [CATALOG_SEGMENT_ECHO_FIELD]: "reg",
      })
      .mockResolvedValueOnce({ products: ["회원가"] })

    const result = await fetchCatalog<{ products: string[] }>(request)

    expect(result.products).toEqual(["회원가"])
  })

  it("Medusa 가 세그먼트를 400 으로 거절하면 토큰으로 폴백한다", async () => {
    // 배포 시차·시크릿 교체로 양쪽 시크릿이 어긋난 구간. 폴백하지 않으면 카탈로그를
    // 그리는 페이지가 통째로 깨진다.
    visitorMock.mockResolvedValue(memberVisitor)
    const rejected = Object.assign(new Error("Invalid catalog segment key"), {
      status: 400,
    })
    fetchMock
      .mockRejectedValueOnce(rejected)
      .mockResolvedValueOnce({ products: ["회원가"] })

    const result = await fetchCatalog<{ products: string[] }>(request)

    expect(result.products).toEqual(["회원가"])
    expect(readHeaders(fetchMock.mock.calls[1])).toHaveProperty("authorization")
  })

  it("진짜 장애는 폴백하지 않고 그대로 올린다", async () => {
    visitorMock.mockResolvedValue(memberVisitor)
    fetchMock.mockRejectedValue(new Error("Medusa 500"))

    await expect(fetchCatalog(request)).rejects.toThrow("Medusa 500")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("fetchCatalog — 렌더 내 중복 합치기", () => {
  it("같은 조회가 여러 번이어도 Medusa 왕복은 한 번이다", async () => {
    visitorMock.mockResolvedValue(memberVisitor)
    fetchMock.mockResolvedValue({ [CATALOG_SEGMENT_ECHO_FIELD]: "mem" })

    await Promise.all([fetchCatalog(request), fetchCatalog(request)])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
