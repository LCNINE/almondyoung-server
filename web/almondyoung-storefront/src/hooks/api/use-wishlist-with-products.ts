"use client"

import { useState, useEffect, useCallback } from "react"
import { WishlistItemWithProduct } from "@lib/services/users/wishlist-with-products"
import { getWishlistWithProducts } from "@lib/services/users/wishlist-with-products"

import { toast } from "sonner"
import {
  onWishlistChange,
  offWishlistChange,
} from "@lib/services/users/wishlist-events"
import { UserBasicInfo } from "@lib/types/ui/user"

export const useWishlistWithProducts = (user: UserBasicInfo | null) => {
  const [wishlistItems, setWishlistItems] = useState<WishlistItemWithProduct[]>(
    []
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 찜한 상품 목록 조회
  const fetchWishlistWithProducts = useCallback(async () => {
    if (!user) {
      setWishlistItems([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const data = await getWishlistWithProducts(user.id)
      setWishlistItems(data)
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "찜한 상품 목록 조회에 실패했습니다."
      setError(errorMessage)
      console.error("찜한 상품 목록 조회 실패:", err)
    } finally {
      setIsLoading(false)
    }
  }, [user])

  // 찜한 상품에서 제거
  const removeFromWishlist = useCallback(
    async (wishlistId: string) => {
      if (!user) {
        throw new Error("로그인이 필요합니다.")
      }

      setIsLoading(true)
      setError(null)

      try {
        // API 호출 (기존 wishlist 서비스 사용)
        const { removeFromWishlistService } = await import(
          "@lib/services/users/wishlist"
        )
        await removeFromWishlistService(wishlistId, {
          userId: user.id,
          useCache: true,
        })

        // 성공 알림
        toast.success("찜 목록에서 제거되었습니다", {
          description: "상품이 찜 목록에서 제거되었습니다.",
        })

        // 로컬 상태에서 제거
        setWishlistItems((prev) =>
          prev.filter((item) => item.id !== wishlistId)
        )
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "찜 목록에서 제거에 실패했습니다."
        setError(errorMessage)

        // 인증 오류인 경우 특별 처리
        if (
          errorMessage.includes("authentication expired") ||
          errorMessage.includes("401")
        ) {
          throw new Error("로그인이 필요합니다.")
        }

        throw err
      } finally {
        setIsLoading(false)
      }
    },
    [user]
  )

  // 초기 로드
  useEffect(() => {
    fetchWishlistWithProducts()
  }, [fetchWishlistWithProducts])

  // 찜한 상품 변경 이벤트 리스너
  useEffect(() => {
    const handleWishlistChange = () => {
      console.log(
        "🔄 [useWishlistWithProducts] 찜한 상품 변경 감지, 목록 새로고침"
      )
      fetchWishlistWithProducts()
    }

    // 이벤트 리스너 등록
    onWishlistChange(handleWishlistChange)

    // 컴포넌트 언마운트 시 이벤트 리스너 제거
    return () => {
      offWishlistChange(handleWishlistChange)
    }
  }, [fetchWishlistWithProducts])

  return {
    wishlistItems,
    isLoading,
    error,
    removeFromWishlist,
    refetch: fetchWishlistWithProducts,
  }
}
