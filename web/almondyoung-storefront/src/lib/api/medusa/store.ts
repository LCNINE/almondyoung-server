"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders, getCacheTag } from "@/lib/data/cookies"
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
    .catch(medusaError)
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
