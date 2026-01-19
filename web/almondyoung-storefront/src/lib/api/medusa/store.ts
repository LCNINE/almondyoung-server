"use server"

import { sdk } from "@/lib/config/medusa"

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
