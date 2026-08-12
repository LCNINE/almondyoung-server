import "server-only"
import { unstable_cache } from "next/cache"
import { cache } from "react"
import { sdk } from "@/lib/config/medusa"
import {
  assertSegmentApplied,
  buildSegmentHeaders,
  CatalogSegmentMismatchError,
  type CatalogSegment,
} from "./catalog-segment"
import { resolveCatalogVisitor } from "./catalog-request"

/** 카테고리 트리 fetch 의 공유 태그. */
export const CATEGORY_TREE_TAG = "categories"

/**
 * 카탈로그 캐시의 시간 만료 한도. 가격·판매중단·품절 전환은 channel-adapter 가
 * `/api/revalidate` 로 즉시 걷어내므로, 시간 만료는 그 훅이 유실됐을 때의 백스톱이다.
 */
export const CATALOG_REVALIDATE_SECONDS = 60 * 60 * 24

/** 직렬화 가능한 쿼리. 그대로 캐시 키에 들어가므로 JSON 으로 표현되는 값만 담는다. */
export type CatalogQuery = Record<string, unknown>

/** 캐시 함수에 넘길 요청. 응답을 가르는 값이 전부 여기 들어 있어야 한다. */
export type CatalogRequest = {
  path: string
  query: CatalogQuery
  tags: string[]
}

/**
 * 캐시 키에 들어가는 값 전부. `unstable_cache` 는 인자를 JSON 으로 직렬화해 키에 넣으므로,
 * 응답을 가르는 값은 반드시 이 객체를 통해 들어와야 한다.
 *
 * 세그먼트 헤더를 이 바깥에서 만들어 클로저로 넘기면 "응답은 바꾸는데 키엔 없는 값"이 된다.
 * 그래서 헤더는 캐시 함수 안쪽에서 `segment` 로부터 만든다.
 */
type CatalogCacheDescriptor = CatalogRequest & { segment: CatalogSegment }

const readSegmentSecret = (): string | undefined => {
  const secret = process.env.CATALOG_SEGMENT_SECRET?.trim()
  return secret ? secret : undefined
}

/**
 * 캐시되는 실제 조회. **모듈 최상위 함수여야 한다** — `unstable_cache` 는 인자와 함수 소스는
 * 키에 넣지만 클로저로 잡은 변수는 넣지 않는다. 요청마다 달라지는 값을 클로저로 잡으면
 * 첫 방문자의 응답이 그 키에 굳어 다른 사람에게 나간다.
 *
 * 안쪽 fetch 는 `no-store` 다. 캐시는 이 함수 바깥의 `unstable_cache` 가 전담한다.
 */
const runSegmentFetch = async (
  descriptor: CatalogCacheDescriptor
): Promise<unknown> => {
  const secret = readSegmentSecret()
  if (!secret) {
    // 호출부가 미리 걸러 여기까진 안 온다. 그래도 시크릿 없이 세그먼트를 주장한 응답이
    // 저장되는 일은 없어야 하므로 던진다(던지면 `unstable_cache` 가 저장하지 않는다).
    throw new CatalogSegmentMismatchError(descriptor.segment, null)
  }

  const body = await sdk.client.fetch<unknown>(descriptor.path, {
    method: "GET",
    query: descriptor.query,
    headers: buildSegmentHeaders(descriptor.segment, secret),
    cache: "no-store",
  })

  assertSegmentApplied(descriptor.segment, body)

  return body
}

/**
 * 태그 조합마다 캐시 함수를 하나씩 만들어 둔다.
 *
 * `unstable_cache` 는 태그를 생성 시점에 고정하는데 상품 태그는 조회마다 다르다.
 * 태그를 키 파츠에도 같이 넣어 서로 다른 태그 조합이 같은 항목을 공유하지 않게 한다.
 */
const cachedFetchersByTag = new Map<
  string,
  (descriptor: CatalogCacheDescriptor) => Promise<unknown>
>()

const getCachedFetcher = (tags: string[]) => {
  const tagKey = [...tags].sort().join("|")

  const existing = cachedFetchersByTag.get(tagKey)
  if (existing) return existing

  const fetcher = unstable_cache(runSegmentFetch, ["catalog", tagKey], {
    tags,
    revalidate: CATALOG_REVALIDATE_SECONDS,
  })
  cachedFetchersByTag.set(tagKey, fetcher)

  return fetcher
}

/**
 * 같은 렌더 안의 중복 요청 합치기.
 *
 * fetch 캐시를 쓸 때는 Next 가 공짜로 해주던 일인데, 캐시를 `unstable_cache` 로 옮기면서
 * 사라졌다. 복원하지 않으면 한 페이지에서 같은 목록을 여러 번 그릴 때 Medusa 왕복이
 * 그만큼 늘어난다. React `cache()` 는 인자를 참조로 비교해 매번 새로 만드는 descriptor 를
 * 못 알아보므로, 요청 스코프 Map 을 만들어 직렬화한 키로 합친다.
 */
const inflightByRequest = cache(() => new Map<string, Promise<unknown>>())

const dedupe = (key: string, run: () => Promise<unknown>): Promise<unknown> => {
  const inflight = inflightByRequest()

  const existing = inflight.get(key)
  if (existing) return existing

  const promise = run()
  inflight.set(key, promise)

  return promise
}

const runPersonalFetch = (
  request: CatalogRequest,
  authHeaders: { authorization: string } | null
): Promise<unknown> =>
  sdk.client.fetch<unknown>(request.path, {
    method: "GET",
    query: request.query,
    headers: authHeaders ? { ...authHeaders } : {},
    cache: "no-store",
  })

/**
 * 카탈로그를 조회한다. 캐시에 넣을지 말지는 이 함수만 정한다.
 *
 * - 회원/일반회원(`mem`/`reg`) → 세그먼트로 공유 캐시. 방문자 수와 무관하게 두 벌이다.
 * - 모름 → 개인 토큰 + 캐시 안 함. Medusa 가 정하게 두고 공유 캐시엔 안 넣는다.
 * - 세그먼트가 적용되지 않은 응답 → 저장하지 않고 개인 토큰으로 다시 받는다.
 */
export const fetchCatalog = async <T>(request: CatalogRequest): Promise<T> => {
  const visitor = await resolveCatalogVisitor()
  const secret = readSegmentSecret()

  const personalKey = `personal:${visitor.authHeaders?.authorization ?? "anon"}:${JSON.stringify(request)}`
  const personal = () =>
    dedupe(personalKey, () =>
      runPersonalFetch(request, visitor.authHeaders)
    ) as Promise<T>

  // 시크릿이 없으면 세그먼트를 신뢰시킬 수 없다. 캐시를 포기하고 토큰으로 간다.
  if (visitor.state === "unknown" || !secret) {
    return personal()
  }

  const descriptor: CatalogCacheDescriptor = {
    ...request,
    segment: visitor.state,
  }

  try {
    return (await dedupe(`segment:${JSON.stringify(descriptor)}`, () =>
      getCachedFetcher(request.tags)(descriptor)
    )) as T
  } catch (error) {
    if (error instanceof CatalogSegmentMismatchError) {
      // 설정이 어긋난 구간(배포 시차, 시크릿 교체, 그룹 id 누락)이다. 조용히 비회원가를
      // 회원 칸에 넣는 대신 토큰으로 정확한 응답을 받는다.
      console.error("[catalog] 세그먼트 적용 실패 — 토큰으로 폴백", {
        claimed: error.claimed,
        applied: error.applied,
        path: request.path,
      })
      return personal()
    }

    throw error
  }
}
