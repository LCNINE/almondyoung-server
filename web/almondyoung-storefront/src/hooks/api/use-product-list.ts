// lib/hooks/use-product-list.ts
"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getProductsByCategoryService } from "@lib/services/pim/products/getProductListService"
import type { ProductCard } from "@lib/types/ui/product"

export type ProductQuery = {
  categoryId: string // 특정 카테고리 ID 또는 "all" (전체 상품 조회)
  page?: number
  limit?: number
  sort?: "popular" | "new" | "priceAsc" | "priceDesc"
  brand?: string
  min?: number
  max?: number
  tags?: string[]        // ["급상승","가을특가"] 등
  stock?: ("in"|"out")[] // 필요시
  q?: string
}

export function useProductList(base: ProductQuery = {} as ProductQuery, syncUrl = true) {
  const router = useRouter()
  const sp = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [items, setItems] = useState<ProductCard[]>([])
  const [total, setTotal] = useState(0)

  // URL → 오버라이드(정렬/페이지 등은 URL이 우선)
  const merged = useMemo<ProductQuery>(() => {
    const toNum = (v: string|null) => (v ? Number(v) : undefined)
    const toArr = (v: string|null) => (v ? v.split(",") : undefined)
    return {
      ...base,
      page:  toNum(sp.get("page"))  ?? base?.page  ?? 1,
      limit: toNum(sp.get("limit")) ?? base?.limit ?? 20,
      sort:  (sp.get("sort") as any) ?? base?.sort,
      brand: sp.get("brand") ?? base?.brand,
      min:   toNum(sp.get("min")) ?? base?.min,
      max:   toNum(sp.get("max")) ?? base?.max,
      tags:  toArr(sp.get("tags")) ?? base?.tags,
    }
  }, [sp, base])

  useEffect(() => {
    // categoryId가 없거나 빈 문자열인 경우에만 로딩 중단
    // "all"은 전체 상품 조회를 위한 유효한 값
    if (!merged.categoryId) {
      setLoading(false)
      return
    }
    
    let ignore = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await getProductsByCategoryService(merged.categoryId, {
          page: merged.page,
          limit: merged.limit,
          sort: merged.sort,
          tags: merged.tags,
          stock: merged.stock,
        })
        if (ignore) return
        setItems(res.items)
        setTotal(res.total ?? 0)
      } catch (e:any) {
        if (!ignore) setError(e?.message ?? "fetch error")
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [JSON.stringify(merged)])

  // URL을 진실원천으로: 필터/정렬/페이지 변경 → 쿼리 업데이트
  const update = (patch: Partial<ProductQuery>) => {
    const q = new URLSearchParams(sp)
    if (patch.page !== undefined) q.set("page", String(patch.page))
    if (patch.limit !== undefined) q.set("limit", String(patch.limit))
    if (patch.sort) q.set("sort", patch.sort)
    if (patch.brand !== undefined) q.set("brand", patch.brand ?? "")
    if (patch.min !== undefined) q.set("min", String(patch.min))
    if (patch.max !== undefined) q.set("max", String(patch.max))
    if (patch.tags) q.set("tags", patch.tags.join(","))
    router.replace(`?${q.toString()}`, { scroll: false })
  }

  return { items, total, loading, error, params: merged, update }
}
