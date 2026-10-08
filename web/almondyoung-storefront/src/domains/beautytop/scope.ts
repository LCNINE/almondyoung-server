export type ScopeFilters = { sido: string; gugun: string; category: string }
export type ScopeLevel = "national" | "province" | "district"

export const DEFAULT_FILTERS: ScopeFilters = {
  sido: "서울",
  gugun: "강남구",
  category: "속눈썹",
}
export const FILTERS_KEY = "beautytop:filters"

export function parseScope(value: unknown): ScopeFilters | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("sido" in value) ||
    !("gugun" in value) ||
    !("category" in value)
  )
    return null
  const { sido, gugun, category } = value
  if (
    typeof sido !== "string" ||
    typeof gugun !== "string" ||
    typeof category !== "string"
  )
    return null
  const filters = {
    sido: sido.trim(),
    gugun: gugun.trim(),
    category: category.trim(),
  }
  if (
    !filters.category ||
    Object.values(filters).some((v) => v.length > 40) ||
    (filters.gugun && !filters.sido)
  )
    return null
  return filters
}

export function scopeLevel(filters: ScopeFilters): ScopeLevel {
  return filters.gugun ? "district" : filters.sido ? "province" : "national"
}

export function scopeQuery(filters: ScopeFilters): {
  category: string
  sido?: string
  gugun?: string
} {
  return {
    category: filters.category,
    ...(filters.sido ? { sido: filters.sido } : {}),
    ...(filters.sido && filters.gugun ? { gugun: filters.gugun } : {}),
  }
}

export function scopeFromSearch(search: string): ScopeFilters | null {
  const query = new URLSearchParams(search)
  if (!query.has("category")) return null
  return parseScope({
    sido: query.get("sido") ?? "",
    gugun: query.get("gugun") ?? "",
    category: query.get("category"),
  })
}
