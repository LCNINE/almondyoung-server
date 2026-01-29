"use server"

import { sdk } from "@/lib/config/medusa"
import {
  getCacheTag,
  removeAccessToken,
  removeCartId,
  removeMedusaAuthToken,
  removeRefreshToken,
} from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { api } from "../api"

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
