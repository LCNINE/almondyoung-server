"use server"

import type { ShopListingResponseDto } from "@/lib/types/dto/shop-listing"
import type { ShopListingItem } from "@/lib/types/ui/shop-listing"
import { headers } from "next/headers"
import { api } from "../api"

const SHOP_LISTINGS_TAG = "shop-listings"

export async function listPublicShopListings(): Promise<ShopListingItem[]> {
  return await api<ShopListingResponseDto[]>("pim", "/shop-listings/public", {
    method: "GET",
    withAuth: false,
    next: { tags: [SHOP_LISTINGS_TAG], revalidate: 60 },
  })
}

// 한글 slug 는 Next 가 이미 인코딩해서 넘길 때가 있어 한 번 풀고 다시 건다 (이중 인코딩 방지)
function encodeSlugOnce(slug: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(slug))
  } catch {
    return encodeURIComponent(slug)
  }
}

export async function getPublicShopListing(
  slug: string
): Promise<ShopListingItem | null> {
  try {
    return await api<ShopListingResponseDto>(
      "pim",
      `/shop-listings/public/${encodeSlugOnce(slug)}`,
      {
        method: "GET",
        withAuth: false,
        next: {
          tags: [SHOP_LISTINGS_TAG, `${SHOP_LISTINGS_TAG}:${slug}`],
          revalidate: 60,
        },
      }
    )
  } catch {
    return null
  }
}

export async function recordShopListingView(slug: string): Promise<void> {
  const forwarded = (await headers()).get("x-forwarded-for") ?? ""
  const visitorIp = forwarded.split(",")[0]?.trim() ?? ""

  try {
    await api<void>(
      "pim",
      `/shop-listings/public/${encodeSlugOnce(slug)}/view`,
      {
        method: "POST",
        withAuth: false,
        cache: "no-store",
        headers: visitorIp ? { "x-visitor-ip": visitorIp } : {},
      }
    )
  } catch {
    // 조회수는 실패해도 페이지가 멀쩡해야 한다
  }
}
