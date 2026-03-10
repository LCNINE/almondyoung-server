"use server"

import { sdk } from "@/lib/config/medusa"
import { getCacheTag, removeAllAuthTokens } from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { api } from "../api"

export async function signout(): Promise<void> {
  // 실패해도ㄱㅊ음 토큰 삭제가 핵심이라
  api<{ success: boolean }>("users", "/auth/signout", {
    method: "POST",
    withAuth: false,
  }).catch(() => {})
  sdk.auth.logout().catch(() => {})

  // 캐시 태그 조회 병렬 처리
  const [customerCacheTag, cartCacheTag] = await Promise.all([
    getCacheTag("customers"),
    getCacheTag("carts"),
  ])

  // 모든 토큰/쿠키 한 번에 삭제
  await removeAllAuthTokens()

  revalidateTag(customerCacheTag)
  revalidateTag(cartCacheTag)
}
