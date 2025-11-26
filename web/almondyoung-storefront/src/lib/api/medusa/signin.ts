"use server"

import {
  getAuthHeaders,
  getCacheTag,
  setMedusaAuthToken,
} from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { transferCart } from "./customer"

export async function medusaSignin() {
  try {
    const headers = {
      ...(await getAuthHeaders("accessToken")),
    }

    const res = await fetch(`${process.env.APP_URL}/api/medusa/signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    })

    if (!res.ok) {
      const result = await res.json()

      return {
        success: false,
        error: result.error,
        message: result.message || "Medusa signin failed",
      }
    }

    const result = await res.json()

    setMedusaAuthToken(result.token)

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)

    try {
      await transferCart()
    } catch (error: any) {
      console.log("Transfer cart error:", error)
    }

    return {
      success: true,
      data: result,
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
