import { cookies as nextCookies, headers as nextHeaders } from "next/headers"
import "server-only"

const getHostnameFromHeader = (hostHeader: string | null): string | null => {
  if (!hostHeader) {
    return null
  }

  const firstHost = hostHeader.split(",")[0]?.trim().toLowerCase()

  if (!firstHost) {
    return null
  }

  if (firstHost.startsWith("[")) {
    const closingIndex = firstHost.indexOf("]")
    if (closingIndex === -1) {
      return firstHost
    }

    return firstHost.slice(1, closingIndex)
  }

  return firstHost.split(":")[0]
}

const isIpHost = (hostname: string) => {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":")
}

const getSecondLevelDomain = (hostname: string): string | undefined => {
  if (!hostname || hostname === "localhost" || isIpHost(hostname)) {
    return undefined
  }

  const parts = hostname.split(".").filter(Boolean)

  if (parts.length < 2) {
    return undefined
  }

  return parts.slice(-2).join(".")
}

export const getTokenCookieDomain = async (): Promise<string | undefined> => {
  try {
    const headers = await nextHeaders()
    const host =
      headers.get("x-forwarded-host") ??
      headers.get("host") ??
      headers.get("x-host")

    const hostname = getHostnameFromHeader(host)

    if (!hostname) {
      return undefined
    }

    return getSecondLevelDomain(hostname)
  } catch {
    return undefined
  }
}

export const getCookies = async () => {
  const cookies = await nextCookies()

  return cookies.toString()
}

export const getAuthHeaders = async (
  cookieName: string = "_medusa_jwt"
): Promise<{ authorization: string } | null> => {
  try {
    const cookies = await nextCookies()
    const token = cookies.get(cookieName)?.value

    if (!token) {
      return null
    }

    return { authorization: `Bearer ${token}` }
  } catch {
    return null
  }
}

export const getAccessToken = async () => {
  const cookies = await nextCookies()
  return cookies.get("accessToken")?.value
}

export const getCacheTag = async (tag: string): Promise<string> => {
  try {
    const cookies = await nextCookies()
    const cacheId = cookies.get("_medusa_cache_id")?.value

    if (!cacheId) {
      return ""
    }

    return `${tag}-${cacheId}`
  } catch (error) {
    return ""
  }
}

export const getCacheOptions = async (
  tag: string
): Promise<{ tags: string[] } | {}> => {
  if (typeof window !== "undefined") {
    return {}
  }

  const cacheTag = await getCacheTag(tag)

  if (!cacheTag) {
    return {}
  }

  return { tags: [`${cacheTag}`] }
}

export const setMedusaAuthToken = async (token: string) => {
  const cookies = await nextCookies()
  {
    cookies.set("_medusa_jwt", token, {
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    })
  }
}

export const setTokenCookies = async (
  accessToken: string,
  refreshToken?: string
) => {
  const cookies = await nextCookies()
  const domain = await getTokenCookieDomain()

  if (domain) {
    cookies.set("accessToken", "", {
      maxAge: -1,
      path: "/",
    })
  }

  cookies.set("accessToken", accessToken, {
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7일: 크로스도메인 결제 리다이렉트 후 세션 쿠키 소실 방지
    ...(domain ? { domain } : {}),
  })

  if (refreshToken) {
    if (domain) {
      cookies.set("refreshToken", "", {
        maxAge: -1,
        path: "/",
      })
    }

    cookies.set("refreshToken", refreshToken, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30일
      ...(domain ? { domain } : {}),
    })
  }
}

export const removeAccessToken = async () => {
  const cookies = await nextCookies()
  const domain = await getTokenCookieDomain()
  cookies.set("accessToken", "", {
    maxAge: -1,
    path: "/",
  })

  if (domain) {
    cookies.set("accessToken", "", {
      maxAge: -1,
      path: "/",
      domain,
    })
  }
}

export const removeRefreshToken = async () => {
  const cookies = await nextCookies()
  const domain = await getTokenCookieDomain()
  cookies.set("refreshToken", "", {
    maxAge: -1,
    path: "/",
  })

  if (domain) {
    cookies.set("refreshToken", "", {
      maxAge: -1,
      path: "/",
      domain,
    })
  }
}

export const removeMedusaAuthToken = async () => {
  const cookies = await nextCookies()
  cookies.set("_medusa_jwt", "", {
    maxAge: -1,
    path: "/",
  })
}

export const getCartId = async () => {
  const cookies = await nextCookies()
  const cartId = cookies.get("_medusa_cart_id")?.value

  return cartId
}

export const setCartId = async (cartId: string) => {
  const cookies = await nextCookies()
  cookies.set("_medusa_cart_id", cartId, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  })
}

export const removeCartId = async () => {
  const cookies = await nextCookies()
  cookies.set("_medusa_cart_id", "", {
    maxAge: -1,
  })
}

export const removeAllAuthTokens = async () => {
  const cookies = await nextCookies()
  const domain = await getTokenCookieDomain()

  // 한 번의 cookies 인스턴스로 모든 쿠키 삭제
  cookies.set("accessToken", "", { maxAge: -1, path: "/" })
  cookies.set("refreshToken", "", { maxAge: -1, path: "/" })
  cookies.set("_medusa_jwt", "", { maxAge: -1, path: "/" })
  cookies.set("_medusa_cart_id", "", { maxAge: -1 })

  // 관심 카테고리 / 배너 dismiss 쿠키도 함께 만료 — 계정 로그아웃 시 anon 상태로 복귀
  cookies.set(INTEREST_CATEGORIES_COOKIE, "", { maxAge: -1, path: "/" })
  cookies.set(INTEREST_BANNER_DISMISSED_COOKIE, "", { maxAge: -1, path: "/" })

  if (domain) {
    cookies.set("accessToken", "", { maxAge: -1, path: "/", domain })
    cookies.set("refreshToken", "", { maxAge: -1, path: "/", domain })
    cookies.set(INTEREST_CATEGORIES_COOKIE, "", { maxAge: -1, path: "/", domain })
    cookies.set(INTEREST_BANNER_DISMISSED_COOKIE, "", { maxAge: -1, path: "/", domain })
  }
}

/*───────────────────────────
 * 관심 카테고리 쿠키
 *──────────────────────────*/

const INTEREST_CATEGORIES_COOKIE = "ay_interest_categories"
const INTEREST_BANNER_DISMISSED_COOKIE = "ay_interest_banner_dismissed_until"
const INTEREST_CATEGORIES_MAX_AGE = 60 * 60 * 24 * 365 // 365일
const INTEREST_BANNER_DISMISS_MAX_AGE = 60 * 60 * 24 * 7 // 7일

const VALID_INTEREST_KEYS = new Set([
  "lash-perm",
  "lash-extension",
  "semi-permanent",
  "nail",
  "tattoo",
  "skincare",
  "hair",
  "waxing",
])

export const getInterestCategoryKeys = async (): Promise<string[]> => {
  try {
    const cookies = await nextCookies()
    const raw = cookies.get(INTEREST_CATEGORIES_COOKIE)?.value
    if (!raw) return []

    const decoded = decodeURIComponent(raw)
    const parsed: unknown = JSON.parse(decoded)
    if (!Array.isArray(parsed)) return []

    // 화이트리스트 sanitize + 중복 제거 + 최대 3개
    const seen = new Set<string>()
    const result: string[] = []
    for (const item of parsed) {
      if (typeof item !== "string") continue
      if (!VALID_INTEREST_KEYS.has(item)) continue
      if (seen.has(item)) continue
      seen.add(item)
      result.push(item)
      if (result.length >= 3) break
    }
    return result
  } catch {
    return []
  }
}

export const setInterestCategoryKeys = async (keys: string[]) => {
  const cookies = await nextCookies()
  const domain = await getTokenCookieDomain()

  // sanitize once more before write
  const sanitized = keys
    .filter((k) => VALID_INTEREST_KEYS.has(k))
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .slice(0, 3)

  const value = encodeURIComponent(JSON.stringify(sanitized))

  if (domain) {
    cookies.set(INTEREST_CATEGORIES_COOKIE, "", { maxAge: -1, path: "/" })
  }
  cookies.set(INTEREST_CATEGORIES_COOKIE, value, {
    maxAge: INTEREST_CATEGORIES_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(domain ? { domain } : {}),
  })
}

export const removeInterestCategoryKeys = async () => {
  const cookies = await nextCookies()
  const domain = await getTokenCookieDomain()
  cookies.set(INTEREST_CATEGORIES_COOKIE, "", { maxAge: -1, path: "/" })
  if (domain) {
    cookies.set(INTEREST_CATEGORIES_COOKIE, "", { maxAge: -1, path: "/", domain })
  }
}

export const getInterestBannerDismissed = async (): Promise<boolean> => {
  try {
    const cookies = await nextCookies()
    const raw = cookies.get(INTEREST_BANNER_DISMISSED_COOKIE)?.value
    if (!raw) return false
    const until = new Date(raw).getTime()
    if (Number.isNaN(until)) return false
    return until > Date.now()
  } catch {
    return false
  }
}

export const setInterestBannerDismissed7Days = async () => {
  const cookies = await nextCookies()
  const domain = await getTokenCookieDomain()
  const until = new Date(Date.now() + INTEREST_BANNER_DISMISS_MAX_AGE * 1000).toISOString()

  cookies.set(INTEREST_BANNER_DISMISSED_COOKIE, until, {
    maxAge: INTEREST_BANNER_DISMISS_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(domain ? { domain } : {}),
  })
}

export const removeInterestBannerDismissed = async () => {
  const cookies = await nextCookies()
  const domain = await getTokenCookieDomain()
  cookies.set(INTEREST_BANNER_DISMISSED_COOKIE, "", { maxAge: -1, path: "/" })
  if (domain) {
    cookies.set(INTEREST_BANNER_DISMISSED_COOKIE, "", { maxAge: -1, path: "/", domain })
  }
}
