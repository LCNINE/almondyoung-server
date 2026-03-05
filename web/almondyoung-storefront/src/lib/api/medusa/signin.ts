"use server"

import { getCacheTag, getCartId, setMedusaAuthToken } from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { recoverCustomerCart, transferCart } from "./customer"
import { api } from "../api"

export async function medusaSignin(): Promise<{
  success: boolean
  data?: string
  error?: string
  code?: string
  message?: string
}> {
  try {
    const data = await api<{ token: string }>(
      "medusa",
      "/auth/customer/my-auth",
      {
        method: "POST",
        withAuth: true,
      }
    )

    await setMedusaAuthToken(data.token)

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)

    // 게스트 카트가 있으면 이전, 없으면 고객 기존 카트 복구
    const cartId = await getCartId()
    if (cartId) {
      await transferCart()
    } else {
      await recoverCustomerCart()
    }

    return {
      success: true,
      data: data.token,
    }
  } catch (error) {
    console.error("medusaSignin error:", error)
    return {
      success: false,
      error: "TOKEN_PROCESS_ERROR",
      code: "TOKEN_PROCESS_ERROR",
      message: "Failed to issue Medusa customer token",
    }
  }
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

    await setMedusaAuthToken(data.token)

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
