"use server"

import { sdk } from "@/lib/config/medusa"
import {
  getAuthHeaders,
  getCartId,
  getCacheTag,
  setCartId,
  setMedusaAuthToken,
} from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { transferCart } from "./customer"
import { api } from "../api"

export async function medusaSignin(): Promise<{
  success: boolean
  data?: string
  error?: string
  message?: string
}> {
  try {
    // 로그인 전 게스트 카트 ID 저장
    const guestCartId = await getCartId()

    const data = await api<{ token: string }>(
      "medusa",
      "/auth/customer/my-auth",
      {
        method: "POST",
        withAuth: true,
      }
    )

    setMedusaAuthToken(data.token)

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)

    //  기존 게스트 카트 → 로그인 고객으로 이전
    try {
      await transferCart()
    } catch (error: any) {
      console.log("Transfer cart error:", error)
    }

    //  고객의 활성 카트 조회 → cart_id 동기화 + 게스트 카트 아이템 병합
    try {
      await recoverCustomerCart(guestCartId)
    } catch (error: any) {
      console.log("Recover cart error:", error)
    }

    return {
      success: true,
      data: data.token,
    }
  } catch (error) {
    console.error("medusaSignin error:", error)
    return {
      success: false,
      error: "NETWORK_ERROR",
      message: "Failed to connect to Medusa API",
    }
  }
}

/**
 * 로그인한 고객의 미완료 카트를 복구하고 cart_id 쿠키를 동기화
 * @param guestCartId - 게스트 카트 ID (전달 시 게스트 아이템을 고객 카트에 병합)
 */
export async function recoverCustomerCart(guestCartId?: string) {
  const headers = {
    ...(await getAuthHeaders()),
  }

  if (!headers.authorization) return

  const res = await sdk.client.fetch<{ cart: { id: string } | null }>(
    "/store/customers/me/cart",
    {
      method: "POST",
      headers,
      body: { guestCartId },
    }
  )

  if (res.cart?.id) {
    await setCartId(res.cart.id)
  }

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)
}

// 임시
export async function medusaSigninAdmin(): Promise<{
  success: boolean
  data?: string
  error?: string
  message?: string
}> {
  try {
    const data = await api<{ token: string }>("medusa", "/auth/user/my-auth", {
      method: "POST",
      withAuth: true,
    })

    setMedusaAuthToken(data.token)

    return {
      success: true,
      data: data.token,
    }
  } catch (error) {
    console.error("medusaSignin error:", error)
    return {
      success: false,
      error: "NETWORK_ERROR",
      message: "Failed to connect to Medusa API",
    }
  }
}
