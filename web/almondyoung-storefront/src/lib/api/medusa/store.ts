"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders, getCacheTag } from "@/lib/data/cookies"
import { HttpApiError } from "@/lib/api/api-error"
import medusaError from "@/lib/utils/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"

let cachedSalesChannelId: string | null | undefined

export const getDefaultSalesChannelId = async () => {
  if (cachedSalesChannelId !== undefined) {
    return cachedSalesChannelId
  }

  const envId =
    process.env.NEXT_PUBLIC_MEDUSA_SALES_CHANNEL_ID ||
    process.env.MEDUSA_SALES_CHANNEL_ID

  if (envId) {
    cachedSalesChannelId = envId
    return cachedSalesChannelId
  }

  try {
    const response = await sdk.client.fetch<{
      store?: { default_sales_channel_id?: string | null }
    }>("/store/store", {
      method: "GET",
      cache: "force-cache",
    })

    cachedSalesChannelId = response?.store?.default_sales_channel_id ?? null
    return cachedSalesChannelId
  } catch (error) {
    cachedSalesChannelId = null
    return cachedSalesChannelId
  }
}

export const addPromotionToCart = async (
  cartId: string,
  promoCodes: string[]
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return await sdk.client
    .fetch<{ cart: HttpTypes.StoreCart }>(`/store/carts/${cartId}/promotions`, {
      method: "POST",
      headers: {
        ...headers,
        "x-publishable-api-key":
          process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
      body: { promo_codes: promoCodes },
    })
    .then(async ({ cart }) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
      return cart
    })
    .catch((error) => {
      // The Medusa JS SDK throws the response body when status is not 2xx.
      // Detect our per-customer limit middleware error so the client can show a specific message.
      if (error?.code === "COUPON_LIMIT_EXCEEDED") {
        const e = new HttpApiError(error.message ?? "쿠폰 사용 한도 초과", 400, "BAD_REQUEST")
        e.digest = "COUPON_LIMIT_EXCEEDED"
        throw e
      }
      if (error?.code === "COUPON_NOT_ASSIGNED") {
        const e = new HttpApiError(error.message ?? "발급된 고객 전용 쿠폰", 400, "BAD_REQUEST")
        e.digest = "COUPON_NOT_ASSIGNED"
        throw e
      }
      medusaError(error)
    })
}

export const removePromotionFromCart = async (
  cartId: string,
  promoCodes: string[]
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return await sdk.client
    .fetch<{ cart: HttpTypes.StoreCart }>(`/store/carts/${cartId}/promotions`, {
      method: "DELETE",
      headers: {
        ...headers,
        "x-publishable-api-key":
          process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
      body: { promo_codes: promoCodes },
    })
    .then(async ({ cart }) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
      return cart
    })
    .catch(medusaError)
}

export type CouponPreviewResult = {
  valid: boolean
  claimable?: boolean
  reason?: string
  message?: string
  is_assigned?: boolean
  promotion?: {
    id: string
    code: string
    visibility: string
    discount: {
      type: string
      value: number
      target_type: string
      currency_code?: string
    } | null
    expires_at: string | null
    promotion_id_to_claim?: string
  }
}

export const previewCouponCode = async (
  code: string
): Promise<CouponPreviewResult> => {
  const headers = {
    ...(await getAuthHeaders()),
    "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
  }
  return sdk.client.fetch<CouponPreviewResult>(
    `/store/coupons/preview?code=${encodeURIComponent(code.trim().toUpperCase())}`,
    { method: "GET", headers }
  )
}

export const claimCoupon = async (promotionId: string): Promise<void> => {
  const headers = {
    ...(await getAuthHeaders()),
    "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
  }
  if (!("authorization" in headers)) {
    const e = new HttpApiError("로그인이 필요합니다.", 401, "UNAUTHORIZED")
    e.digest = "UNAUTHORIZED"
    throw e
  }
  await sdk.client
    .fetch<unknown>(`/store/customers/me/promotions/${promotionId}/claim`, {
      method: "POST",
      headers,
    })
    .catch(medusaError)
}
