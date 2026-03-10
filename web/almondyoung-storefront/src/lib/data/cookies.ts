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

  if (domain) {
    cookies.set("accessToken", "", { maxAge: -1, path: "/", domain })
    cookies.set("refreshToken", "", { maxAge: -1, path: "/", domain })
  }
}
