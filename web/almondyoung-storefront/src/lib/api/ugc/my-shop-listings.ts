"use server"

import { revalidateTag } from "next/cache"
import {
  toActionFailure,
  type ShopListingActionResult,
} from "@/domains/shop-trade/action-result"
import type {
  MemberShopListingPayload,
  MyShopListingResponseDto,
} from "@/lib/types/dto/shop-listing"
import { api } from "../api"

// 공개 조회(shop-listings.ts)의 캐시 태그. 회원이 글을 바꾸면 이 서버의 ISR 캐시는 바로 비운다 —
// CDN 층은 남으므로 공개 반영은 여전히 「60초 안」이다.
const SHOP_LISTINGS_TAG = "shop-listings"

async function call<T>(
  path: string,
  init: { method: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown },
  mutates: boolean
): Promise<ShopListingActionResult<T>> {
  try {
    const data = await api<T>("ugc", path, {
      method: init.method,
      body: init.body,
      withAuth: true,
      cache: "no-store",
    })
    if (mutates) revalidateTag(SHOP_LISTINGS_TAG)
    return { ok: true, data }
  } catch (error) {
    return toActionFailure(error)
  }
}

export async function listMyShopListings() {
  return call<MyShopListingResponseDto[]>("/shop-listings/mine", { method: "GET" }, false)
}

export async function getMyShopListing(id: string) {
  return call<MyShopListingResponseDto>(
    `/shop-listings/${encodeURIComponent(id)}`,
    { method: "GET" },
    false
  )
}

export async function createMyShopListing(payload: MemberShopListingPayload) {
  return call<MyShopListingResponseDto>(
    "/shop-listings",
    { method: "POST", body: payload },
    true
  )
}

export async function updateMyShopListing(
  id: string,
  payload: MemberShopListingPayload
) {
  return call<MyShopListingResponseDto>(
    `/shop-listings/${encodeURIComponent(id)}`,
    { method: "PUT", body: payload },
    true
  )
}

export async function closeMyShopListing(id: string) {
  return call<MyShopListingResponseDto>(
    `/shop-listings/${encodeURIComponent(id)}/close`,
    { method: "POST" },
    true
  )
}

export async function reopenMyShopListing(id: string) {
  return call<MyShopListingResponseDto>(
    `/shop-listings/${encodeURIComponent(id)}/reopen`,
    { method: "POST" },
    true
  )
}

export async function deleteMyShopListing(id: string) {
  return call<void>(
    `/shop-listings/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    true
  )
}
