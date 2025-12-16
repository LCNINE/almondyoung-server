"use server"

import { sdk } from "@lib/app-config"
import {
  getCacheTag,
  removeAccessToken,
  removeCartId,
  removeMedusaAuthToken,
  removeRefreshToken,
} from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { api } from "../api"

/**
 * 사용자 로그아웃을 처리합니다.
 * - 백엔드 세션 종료
 * - Medusa 인증 종료
 * - 모든 쿠키 제거
 * - 캐시 무효화
 */
export async function signout(): Promise<void> {
  try {
    await api<{ success: boolean }>("users", "/auth/signout", {
      method: "POST",
      withAuth: false,
    })
  } catch (error) {
    console.error("Signout error:", error)
    // 로그아웃은 실패해도 계속 진행 (쿠키는 삭제해야 함)
  }

  await sdk.auth.logout()

  await removeMedusaAuthToken()
  await removeAccessToken()
  await removeRefreshToken()

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  await removeCartId()

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)

  return
}
