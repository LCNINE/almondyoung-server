import type { BeautyTopKind } from "./types"

export type LocalShop = { id: number; kind: BeautyTopKind; name: string; sido?: string | null; gugun?: string | null; category?: string | null }
export type ServerShop = { shopKind: BeautyTopKind; shopId: number; name: string; sido?: string | null; gugun?: string | null; category?: string | null }

export const toServerShop = (s: LocalShop): ServerShop => ({
  shopKind: s.kind,
  shopId: s.id,
  name: s.name,
  sido: s.sido ?? null,
  gugun: s.gugun ?? null,
  category: s.category ?? null,
})

export const toLocalShop = (s: ServerShop): LocalShop => ({
  id: s.shopId,
  kind: s.shopKind,
  name: s.name,
  ...(s.sido ? { sido: s.sido } : {}),
  ...(s.gugun ? { gugun: s.gugun } : {}),
  ...(s.category ? { category: s.category } : {}),
})

function isLocalShop(value: unknown): value is LocalShop {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return Number.isInteger(v.id) && (v.id as number) > 0 && typeof v.name === "string" && v.name.length > 0
}

/**
 * What this browser saved before shops lived on the server. Moved only into an account that has
 * nothing saved yet — otherwise a shop removed on another device would come back from an old browser.
 */
export function planLocalMigration(
  server: { myShop: ServerShop | null; watch: ServerShop[] },
  localMyShop: unknown,
  localWatch: unknown,
  max: number
): { myShop: ServerShop | null; watch: ServerShop[] } | null {
  if (server.myShop || server.watch.length > 0) return null
  const myShop = isLocalShop(localMyShop) ? toServerShop({ ...localMyShop, kind: localMyShop.kind ?? "SHOP" }) : null
  const seen = new Set<string>()
  const watch = (Array.isArray(localWatch) ? localWatch : [])
    .filter(isLocalShop)
    .map((s) => toServerShop({ ...s, kind: s.kind ?? "SHOP" }))
    .filter((s) => {
      const key = `${s.shopKind}:${s.shopId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, max)
  return myShop || watch.length ? { myShop, watch } : null
}
