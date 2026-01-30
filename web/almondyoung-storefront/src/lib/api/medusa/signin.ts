"use server"

import {
  getAuthHeaders,
  getCacheTag,
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

    try {
      await transferCart()
    } catch (error: any) {
      console.log("Transfer cart error:", error)
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
