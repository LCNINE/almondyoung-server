"use server"

import { sdk } from "@/lib/config/medusa"
import {
  getCacheTag,
  removeAccessToken,
  removeMedusaAuthToken,
  removeRefreshToken,
} from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { api } from "../api"

/**
 * 사용자 로그아웃을 처리합니다.
 * - 백엔드 세션 종료
 * - Medusa 인증 종료
 * - 인증 관련 쿠키 제거 (장바구니 ID는 유지)
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

  // 장바구니 ID는 삭제하지 않음 - 다시 로그인하면 복원됨
  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)

  return
}
