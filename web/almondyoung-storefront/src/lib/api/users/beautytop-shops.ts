"use server"

import { api } from "../api"
import { ApiAuthError, HttpApiError } from "../api-error"

export type SavedBeautyTopShop = {
  shopKind: "SHOP" | "PERSON"
  shopId: number
  name: string
  sido?: string | null
  gugun?: string | null
  category?: string | null
}

export type SavedBeautyTopShops = { myShop: SavedBeautyTopShop | null; watch: SavedBeautyTopShop[] }

// Server-action errors lose their message in production, so expected outcomes come back as values.
export type SavedShopsResult = { ok: true; data: SavedBeautyTopShops } | { ok: false; code: "FULL" | "FAILED" }

async function run(task: () => Promise<SavedBeautyTopShops>): Promise<SavedShopsResult> {
  try {
    return { ok: true, data: await task() }
  } catch (error) {
    if (error instanceof ApiAuthError) throw error
    return { ok: false, code: error instanceof HttpApiError && error.status === 409 ? "FULL" : "FAILED" }
  }
}

export async function getSavedBeautyTopShops(): Promise<SavedBeautyTopShops> {
  return api<SavedBeautyTopShops>("users", "/beautytop/shops", { method: "GET", cache: "no-store" })
}

export async function setMyBeautyTopShop(shop: SavedBeautyTopShop | null): Promise<SavedShopsResult> {
  return run(() => api<SavedBeautyTopShops>("users", "/beautytop/shops/my-shop", { method: "PUT", body: { shop } }))
}

export async function addWatchedBeautyTopShop(shop: SavedBeautyTopShop): Promise<SavedShopsResult> {
  return run(() => api<SavedBeautyTopShops>("users", "/beautytop/shops/watch", { method: "POST", body: shop }))
}

export async function removeWatchedBeautyTopShop(shopKind: string, shopId: number): Promise<SavedShopsResult> {
  return run(() =>
    api<SavedBeautyTopShops>("users", `/beautytop/shops/watch/${encodeURIComponent(shopKind)}/${shopId}`, { method: "DELETE" })
  )
}
