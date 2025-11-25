import { cookies as nextCookies } from "next/headers"
import "server-only"

export const getCookies = async () => {
  const cookies = await nextCookies()

  return cookies.toString()
}

export const getAuthHeaders = async (
  cookieName: string = "_medusa_jwt"
): Promise<{ authorization: string } | {}> => {
  try {
    const cookies = await nextCookies()
    const token = cookies.get(cookieName)?.value

    if (!token) {
      return {}
    }

    return { authorization: `Bearer ${token}` }
  } catch {
    return {}
  }
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

  cookies.set("accessToken", accessToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  })

  if (refreshToken) {
    cookies.set("refreshToken", refreshToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    })
  }
}

export const removeAccessToken = async () => {
  const cookies = await nextCookies()
  cookies.set("accessToken", "", {
    maxAge: -1,
    path: "/",
  })
}

export const removeRefreshToken = async () => {
  const cookies = await nextCookies()
  cookies.set("refreshToken", "", {
    maxAge: -1,
    path: "/",
  })
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

  // Mock 환경에서는 cart ID가 없으면 mock cart ID 반환
  if (!cartId) {
    return "mock-cart-001"
  }

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
