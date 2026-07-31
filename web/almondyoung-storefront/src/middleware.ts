// 목업 데이터 제거 - 실제 메두사 서버 또는 기본 리전 사용
import { HttpTypes } from "@medusajs/types"
import { NextRequest, NextResponse } from "next/server"
import {
  APP_CONTEXT_HEADER,
  parseAppContext,
  serializeAppContext,
} from "@/lib/app-context/parse"
import { getBackendBaseUrl } from "@/lib/config/backend"

const MEDUSA_BASE_URL = getBackendBaseUrl("medusa")
const PUBLISHABLE_API_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
// 기본 리전을 'kr'로 설정
const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"

// 보호 경로 — countryCode prefix 뒤의 path 가 이들로 시작하면 비인증 시 OIDC 로그인 진입 페이지로 redirect.
// 공개: /(main)/*, /(auth)/*, /(policies)/*, /cart, /order/track 등 게스트 허용
const PROTECTED_PATH_PREFIXES = ["/mypage", "/consents"]

function isProtectedPath(pathname: string): boolean {
  // pathname: "/kr/mypage/..." → countryCode 제거하고 prefix 매칭
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length < 2) return false
  const afterCountry = "/" + segments.slice(1).join("/")
  return PROTECTED_PATH_PREFIXES.some((p) => afterCountry.startsWith(p))
}

function buildLoginRedirect(request: NextRequest): NextResponse {
  // storefront /login 페이지가 startOidcLogin 으로 medusa SSO 플로우를 시작한다.
  const segments = request.nextUrl.pathname.split("/").filter(Boolean)
  const country = segments[0] || DEFAULT_REGION
  const url = new URL(`/${country}/login`, request.nextUrl.origin)
  url.searchParams.set("redirect_to", request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(url, 307)
}

function isJwtExpired(token?: string, skewSeconds = 30): boolean {
  if (!token) return true

  try {
    const payload = token.split(".")[1]
    if (!payload) return true
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    )
    const decoded = JSON.parse(atob(padded)) as { exp?: number }

    if (!decoded.exp) return true

    return decoded.exp <= Math.floor(Date.now() / 1000) + skewSeconds
  } catch {
    return true
  }
}

function buildRestoreTokenRedirect(request: NextRequest): NextResponse {
  const url = new URL("/api/auth/restore-token", request.nextUrl.origin)
  url.searchParams.set("return_to", request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(url, 307)
}

const regionMapCache = {
  regionMap: new Map<string, HttpTypes.StoreRegion>(),
  regionMapUpdated: Date.now(),
}

async function getRegionMap(cacheId: string) {
  const { regionMap, regionMapUpdated } = regionMapCache

  if (!MEDUSA_BASE_URL) {
    // 메두사 서버 URL이 없으면 기본 리전만 사용
    const defaultRegionMap = new Map()
    defaultRegionMap.set(DEFAULT_REGION, { id: DEFAULT_REGION, name: "Korea" })
    return defaultRegionMap
  }

  if (
    !regionMap.keys().next().value ||
    regionMapUpdated < Date.now() - 3600 * 1000
  ) {
    try {
      // Fetch regions from Medusa. We can't use the JS client here because middleware is running on Edge and the client needs a Node environment.
      const { regions } = await fetch(`${MEDUSA_BASE_URL}/store/regions`, {
        headers: {
          "x-publishable-api-key": PUBLISHABLE_API_KEY!,
        },
        next: {
          revalidate: 3600,
          tags: [`regions-${cacheId}`],
        },
        cache: "force-cache",
      }).then(async (response) => {
        const json = await response.json()
        if (!response.ok) {
          throw new Error(json.message)
        }
        return json
      })
      if (!regions?.length) {
        throw new Error(
          "No regions found. Please set up regions in your Medusa Admin."
        )
      }
      // Create a map of country codes to regions.
      regions.forEach((region: HttpTypes.StoreRegion) => {
        region.countries?.forEach((c) => {
          regionMapCache.regionMap.set(c.iso_2 ?? "", region)
        })
      })

      regionMapCache.regionMapUpdated = Date.now()
    } catch (error) {
      // API 호출 실패 시 기본 리전만 사용
      console.warn(
        "Middleware.ts: regions API 호출 실패. 기본 리전을 사용합니다."
      )
      const defaultRegionMap = new Map()
      defaultRegionMap.set(DEFAULT_REGION, {
        id: DEFAULT_REGION,
        name: "Korea",
      })
      return defaultRegionMap
    }
  }

  return regionMapCache.regionMap
}

/**
 * Fetches regions from Medusa and sets the region cookie.
 * @param request
 * @param response
 */
async function getCountryCode(
  request: NextRequest,
  regionMap: Map<string, HttpTypes.StoreRegion | number>
) {
  try {
    let countryCode

    const vercelCountryCode = request.headers
      .get("x-vercel-ip-country")
      ?.toLowerCase()

    const urlCountryCode = request.nextUrl.pathname.split("/")[1]?.toLowerCase()

    if (urlCountryCode && regionMap.has(urlCountryCode)) {
      countryCode = urlCountryCode
    } else if (vercelCountryCode && regionMap.has(vercelCountryCode)) {
      countryCode = vercelCountryCode
    } else if (regionMap.has(DEFAULT_REGION)) {
      countryCode = DEFAULT_REGION
    } else if (regionMap.keys().next().value) {
      countryCode = regionMap.keys().next().value
    }

    return countryCode
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        "Middleware.ts: Error getting the country code. Did you set up regions in your Medusa Admin and define a MEDUSA_BACKEND_URL environment variable? Note that the variable is no longer named NEXT_PUBLIC_MEDUSA_BACKEND_URL."
      )
    }
  }
}

// 존재가 확인된 handle 만 담는다. 없는 handle 을 캐시하면 관리자가 새로 만든
// 카테고리/상품이 TTL 동안 404 로 남는다.
const knownHandles = new Map<string, number>()
const KNOWN_HANDLE_TTL_MS = 5 * 60 * 1000

const isKnownHandle = (key: string) => {
  const seenAt = knownHandles.get(key)
  if (!seenAt) return false
  if (Date.now() - seenAt > KNOWN_HANDLE_TTL_MS) {
    knownHandles.delete(key)
    return false
  }
  return true
}

// countryCode 다음 세그먼트 → store API 경로/응답 키
const STORE_LOOKUPS = {
  category: {
    path: "/store/product-categories",
    key: "product_categories",
  },
  products: {
    path: "/store/products",
    key: "products",
  },
} as const

type StoreLookupKind = keyof typeof STORE_LOOKUPS

/**
 * 존재하지 않거나 노출 대상이 아닌 카테고리/상품 URL 을 진짜 404 로 응답한다.
 *
 * 페이지 안에서 notFound() 를 불러도 상태가 200 으로 굳는다 — `(main)` 레이아웃이
 * 헤더 데이터를 서버에서 받아오며 셸을 먼저 흘려보내기 때문이다(soft 404).
 * 미들웨어는 렌더 전에 돌기 때문에 상태를 확실히 정할 수 있다.
 *
 * store API 는 비활성 카테고리와 미게시 상품을 애초에 돌려주지 않으므로,
 * 삭제/숨김 처리된 URL 도 여기서 걸러진다.
 * 조회 실패(네트워크/키 문제)는 통과시킨다 — 정상 페이지를 404 로 막는 쪽이 더 위험하다.
 */
async function resolveStorefrontNotFound(
  request: NextRequest
): Promise<NextResponse | undefined> {
  const segments = request.nextUrl.pathname.split("/").filter(Boolean)
  const kind = segments[1] as StoreLookupKind | undefined
  if (!kind || !(kind in STORE_LOOKUPS)) return

  // /category/대분류/중분류 는 마지막 세그먼트가 실제 카테고리, /products/{handle} 는 하나뿐
  const handle = kind === "category" ? segments[segments.length - 1] : segments[2]
  if (!handle || segments.length < 3) return

  const cacheKey = `${kind}:${handle}`
  if (isKnownHandle(cacheKey)) return

  const lookup = STORE_LOOKUPS[kind]

  try {
    const url = new URL(lookup.path, MEDUSA_BASE_URL)
    url.searchParams.set("handle", handle)
    url.searchParams.set("fields", "id")
    url.searchParams.set("limit", "1")

    const res = await fetch(url, {
      headers: PUBLISHABLE_API_KEY
        ? { "x-publishable-api-key": PUBLISHABLE_API_KEY }
        : {},
    })
    if (!res.ok) return

    const body = (await res.json()) as Record<string, unknown[] | undefined>
    if ((body[lookup.key]?.length ?? 0) > 0) {
      knownHandles.set(cacheKey, Date.now())
      return
    }

    return NextResponse.rewrite(
      new URL(`/${segments[0]}/__not-found`, request.url),
      { status: 404 }
    )
  } catch {
    return
  }
}

/**
 * Middleware to handle region selection and onboarding status.
 */
export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get("accessToken")?.value
  const refreshToken = request.cookies.get("refreshToken")?.value

  // Server Action 요청은 내부에서 ApiAuthError를 직접 throw하므로
  // 미들웨어 리다이렉트 대상에서 제외한다. 리다이렉트하면 Next.js 클라이언트가
  // Server Action 응답으로 파싱 실패해서 일반 에러가 error.tsx로 흘러 UNAUTHORIZED 처리가 안 된다.
  const isServerAction = request.headers.has("Next-Action")
  if (!isServerAction && refreshToken && isJwtExpired(accessToken)) {
    return buildRestoreTokenRedirect(request)
  }

  if (!isServerAction) {
    const notFoundResponse = await resolveStorefrontNotFound(request)
    if (notFoundResponse) return notFoundResponse
  }

  // 인증 게이트: 보호 경로에 비인증 접근 시 storefront /login 으로 redirect.
  // OIDC 통합 후 customer 세션의 SoT 는 _medusa_jwt 쿠키 단 하나.
  if (
    isProtectedPath(request.nextUrl.pathname) &&
    !request.cookies.get("_medusa_jwt")?.value
  ) {
    return buildLoginRedirect(request)
  }

  let redirectUrl = request.nextUrl.href

  let response = NextResponse.redirect(redirectUrl, 307)

  let cacheIdCookie = request.cookies.get("_medusa_cache_id")

  let cacheId = cacheIdCookie?.value || crypto.randomUUID()

  const regionMap = await getRegionMap(cacheId)
  const countryCode = regionMap && (await getCountryCode(request, regionMap))

  const urlHasCountryCode =
    countryCode && request.nextUrl.pathname.split("/")[1].includes(countryCode)

  // if one of the country codes is in the url and the cache id is set, return next

  // prefetch 요청에 traceparent sampled=0 설정 → OTel trace 수집 제외
  const isPrefetch = request.headers.get("Next-Router-Prefetch") === "1"

  // 제목 추출코드
  if (urlHasCountryCode && cacheIdCookie) {
    // pathname을 헤더에 추가하여 layout에서 사용 가능하도록 설정
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-pathname", request.nextUrl.pathname)

    // requestHeaders 는 클라이언트 요청 헤더의 복사본이므로, 외부에서 실어 보낸
    // APP_CONTEXT_HEADER 를 먼저 지운다. 지우지 않으면 아무나 헤더를 위조해
    // 앱 컨텍스트를 사칭할 수 있고, 이 헤더를 신뢰하는 의미가 사라진다.
    requestHeaders.delete(APP_CONTEXT_HEADER)
    const appContext = parseAppContext(request.headers.get("user-agent"))
    if (appContext) {
      requestHeaders.set(APP_CONTEXT_HEADER, serializeAppContext(appContext))
    }

    if (isPrefetch && !request.headers.has("traceparent")) {
      const traceId = crypto.randomUUID().replace(/-/g, "")
      const spanId = traceId.substring(0, 16)
      requestHeaders.set("traceparent", `00-${traceId}-${spanId}-00`)
    }

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
  }

  // if one of the country codes is in the url and the cache id is not set, set the cache id and continue
  if (urlHasCountryCode && !cacheIdCookie) {
    // pathname을 헤더에 추가하여 layout에서 사용 가능하도록 설정
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-pathname", request.nextUrl.pathname)

    // requestHeaders 는 클라이언트 요청 헤더의 복사본이므로, 외부에서 실어 보낸
    // APP_CONTEXT_HEADER 를 먼저 지운다. 지우지 않으면 아무나 헤더를 위조해
    // 앱 컨텍스트를 사칭할 수 있고, 이 헤더를 신뢰하는 의미가 사라진다.
    requestHeaders.delete(APP_CONTEXT_HEADER)
    const appContext = parseAppContext(request.headers.get("user-agent"))
    if (appContext) {
      requestHeaders.set(APP_CONTEXT_HEADER, serializeAppContext(appContext))
    }

    if (isPrefetch && !request.headers.has("traceparent")) {
      const traceId = crypto.randomUUID().replace(/-/g, "")
      const spanId = traceId.substring(0, 16)
      requestHeaders.set("traceparent", `00-${traceId}-${spanId}-00`)
    }

    const nextResponse = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })

    nextResponse.cookies.set("_medusa_cache_id", cacheId, {
      maxAge: 60 * 60 * 24,
    })

    return nextResponse
  }

  // check if the url is a static asset
  if (request.nextUrl.pathname.includes(".")) {
    return NextResponse.next()
  }

  const queryString = request.nextUrl.search ? request.nextUrl.search : ""

  // If no country code is set, we redirect to the relevant region.
  if (!urlHasCountryCode && countryCode) {
    // 첫 segment 가 2글자 country-like 인데 region map 에 없는 경우(미등록 region)
    // 그 prefix 를 제거하고 fallback region 으로 교체한다. 예: /us/cart -> /kr/cart
    const pathSegments = request.nextUrl.pathname.split("/").filter(Boolean)
    const firstSegment = pathSegments[0] ?? ""
    const hasInvalidCountryPrefix = /^[a-z]{2}$/i.test(firstSegment)
    const restPath = hasInvalidCountryPrefix
      ? pathSegments.slice(1).join("/")
      : pathSegments.join("/")
    const normalizedRest = restPath ? `/${restPath}` : ""

    redirectUrl = `${request.nextUrl.origin}/${countryCode}${normalizedRest}${queryString}`
    // 308 = 영구 + 메서드 보존. 307(임시)이면 / 가 계속 별도 URL 로 남아
    // /kr 로 링크 지분이 합쳐지지 않는다. 301 은 POST 를 GET 으로 바꿀 수 있어 308 사용.
    response = NextResponse.redirect(`${redirectUrl}`, 308)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|images|assets|png|svg|jpg|jpeg|gif|webp).*)",
  ],
}
