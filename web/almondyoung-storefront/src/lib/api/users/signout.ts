"use server"

import { sdk } from "@/lib/config/medusa"
import { oidcSignOut } from "@/lib/api/medusa/sso"
import { getCacheTag, removeAllAuthTokens } from "@lib/data/cookies"
import { revalidateTag } from "next/cache"

// OIDC 통합 후 로그아웃 흐름:
// 1) medusa SDK logout (best-effort)
// 2) 모든 인증 쿠키 정리 (_medusa_jwt 등)
// 3) /oauth/end_session 으로 redirect → IdP 세션도 만료시키고 홈으로 복귀
export async function signout(countryCode: string = "kr"): Promise<void> {
  try {
    sdk.auth.logout().catch(() => {})

    const [customerCacheTag, cartCacheTag] = await Promise.all([
      getCacheTag("customers"),
      getCacheTag("carts"),
    ])

    await removeAllAuthTokens()

    if (customerCacheTag) revalidateTag(customerCacheTag)
    if (cartCacheTag) revalidateTag(cartCacheTag)
  } catch (error) {
    console.error("로그아웃 중 오류:", error)
  }

  await oidcSignOut(countryCode)
}
