"use client"

import { getProductsByMasterIds } from "@/lib/api/pim/products"
import type { ProductDetailDto } from "@lib/types/dto/pim"
import { useEffect, useMemo, useRef, useState } from "react"

interface UseBannerProductsReturn {
  products: ProductDetailDto[]
  isLoading: boolean
  error: string | null
}

/**
 * 배너 연관 제품을 조회하는 Hook
 * linkedProductMasterIds를 받아서 제품 정보를 클라이언트에서 비동기로 조회합니다.
 */
export function useBannerProducts(
  masterIds: string[]
): UseBannerProductsReturn {
  const [products, setProducts] = useState<ProductDetailDto[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 배열 참조 안정화
  const masterIdsKey = useMemo(() => masterIds.sort().join(","), [masterIds])
  const prevKeyRef = useRef(masterIdsKey)

  useEffect(() => {
    // 같은 ID들이면 재요청하지 않음
    if (prevKeyRef.current === masterIdsKey && products.length > 0) {
      return
    }
    prevKeyRef.current = masterIdsKey

    if (masterIds.length === 0) {
      setProducts([])
      return
    }

    let isCancelled = false

    const fetchProducts = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const results = await getProductsByMasterIds(masterIds)
        if (!isCancelled) {
          setProducts(results)
        }
      } catch (err) {
        if (!isCancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "제품 조회 중 오류가 발생했습니다."
          )
          setProducts([])
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchProducts()

    return () => {
      isCancelled = true
    }
  }, [masterIdsKey, masterIds])

  return {
    products,
    isLoading,
    error,
  }
}
