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
    console.info("[medusaSignin] requesting /auth/customer/my-auth")
    const data = await api<{ token: string }>(
      "medusa",
      "/auth/customer/my-auth",
      {
        method: "POST",
        withAuth: true,
      }
    )
    console.info("[medusaSignin] my-auth ok", {
      tokenLen: data?.token?.length ?? 0,
    })

    await setMedusaAuthToken(data.token)
    console.info("[medusaSignin] _medusa_jwt cookie set")

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)

    // 게스트 카트가 있으면 이전, 없으면 고객 기존 카트 복구
    const cartId = await getCartId()
    if (cartId) {
      console.info("[medusaSignin] transferCart", { cartId })
      try {
        await transferCart()
      } catch (e) {
        console.error("[medusaSignin] transferCart failed", {
          name: (e as Error)?.name,
          message: (e as Error)?.message,
        })
      }
    } else {
      console.info("[medusaSignin] recoverCustomerCart")
      try {
        await recoverCustomerCart()
      } catch (e) {
        console.error("[medusaSignin] recoverCustomerCart failed", {
          name: (e as Error)?.name,
          message: (e as Error)?.message,
        })
      }
    }

    return {
      success: true,
      data: data.token,
    }
  } catch (error) {
    const err = error as Error & { status?: number; code?: string }
    console.error("[medusaSignin] error", {
      name: err?.name,
      message: err?.message,
      status: err?.status,
      code: err?.code,
      stack: err?.stack,
    })
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
