"use server"

import { sdk } from "@/lib/config/medusa"
import { getCacheTag, removeAllAuthTokens } from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { api } from "../api"

export async function signout(): Promise<void> {
  try {
    await api<{ success: boolean }>("users", "/auth/signout", {
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
  } catch (error) {
    console.error("로그아웃 중 오류:", error)
  }

  // redirect는 try 밖에서 (에러 나도 항상 홈으로 이동)
  redirect("/")
}
