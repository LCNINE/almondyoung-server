"use client"

import { useState, useEffect, useCallback } from "react"
import { WishlistItem } from "@lib/api/users/wishlist"
import {
  getWishlistService,
  addToWishlistService,
  removeFromWishlistService,
  isProductInWishlistService,
  toggleWishlistService,
} from "@lib/services/users/wishlist"
import { toast } from "sonner"
import { UserBasicInfo } from "@lib/types/ui/user"

export const useWishlist = (user: UserBasicInfo | null) => {
  const [wishlist, setWishlist] = useState<WishlistItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 위시리스트 조회
  const fetchWishlist = useCallback(async () => {
    // user 객체가 있으면 로그인된 것으로 간주
    if (!user) {
      setWishlist([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const data = await getWishlistService({
        userId: user.id,
        useCache: true,
      })
      setWishlist(data)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "위시리스트 조회에 실패했습니다."
      )
    } finally {
      setIsLoading(false)
    }
  }, [user])

  // 위시리스트에 상품 추가
  const addItem = useCallback(
    async (productId: string) => {
      if (!user) {
        throw new Error("로그인이 필요합니다.")
      }

      setIsLoading(true)
      setError(null)

      try {
        await addToWishlistService(productId, {
          userId: user.id,
          useCache: true,
        })

        // 성공 알림
        toast.success("찜 목록에 추가되었습니다", {
          description: "상품이 찜 목록에 성공적으로 추가되었습니다.",
        })
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "위시리스트 추가에 실패했습니다."
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

        // 작업 완료 후 서버에서 최신 데이터 조회하여 상태 동기화
        try {
          const updatedWishlist = await getWishlistService({
            userId: user.id,
            useCache: false,
          })
          setWishlist(updatedWishlist)
        } catch (syncError) {
          console.error("위시리스트 동기화 실패:", syncError)
        }
      }
    },
    [user]
  )

  // 위시리스트에서 상품 제거
  const removeItem = useCallback(
    async (wishlistId: string) => {
      if (!user) {
        throw new Error("로그인이 필요합니다.")
      }

      setIsLoading(true)
      setError(null)

      try {
        await removeFromWishlistService(wishlistId, {
          userId: user.id,
          useCache: true,
        })

        // 제거 성공 알림
        toast.success("찜 목록에서 제거되었습니다", {
          description: "상품이 찜 목록에서 제거되었습니다.",
        })
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "위시리스트 제거에 실패했습니다."
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

        // 작업 완료 후 서버에서 최신 데이터 조회하여 상태 동기화
        try {
          const updatedWishlist = await getWishlistService({
            userId: user.id,
            useCache: false,
          })
          setWishlist(updatedWishlist)
        } catch (syncError) {
          console.error("위시리스트 동기화 실패:", syncError)
        }
      }
    },
    [user]
  )

  // 상품이 위시리스트에 있는지 확인
  const isInWishlist = useCallback(
    (productId: string): boolean => {
      return wishlist.some((item) => item.productId === productId)
    },
    [wishlist]
  )

  // 상품의 위시리스트 ID 찾기
  const getWishlistId = useCallback(
    (productId: string): string | null => {
      const item = wishlist.find((item) => item.productId === productId)
      return item?.id || null
    },
    [wishlist]
  )

  // 토글 기능 (추가/제거)
  const toggleItem = useCallback(
    async (productId: string) => {
      if (!user) {
        throw new Error("로그인이 필요합니다.")
      }

      setIsLoading(true)
      setError(null)

      try {
        // 현재 상태 확인
        const existingItem = wishlist.find(
          (item) => item.productId === productId
        )

        if (existingItem) {
          // 제거 작업
          await removeFromWishlistService(existingItem.id, {
            userId: user.id,
            useCache: true,
          })

          toast.success("찜 목록에서 제거되었습니다", {
            description: "상품이 찜 목록에서 제거되었습니다.",
          })

          return { added: false }
        } else {
          // 추가 작업
          await addToWishlistService(productId, {
            userId: user.id,
            useCache: true,
          })

          toast.success("찜 목록에 추가되었습니다", {
            description: "상품이 찜 목록에 성공적으로 추가되었습니다.",
          })

          return { added: true }
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "위시리스트 처리에 실패했습니다."
        setError(errorMessage)

        // 인증 오류인 경우 특별 처리
        if (
          errorMessage.includes("authentication expired") ||
          errorMessage.includes("401") ||
          errorMessage.includes("로그인이 필요합니다")
        ) {
          throw new Error("로그인이 필요합니다.")
        }

        throw err
      } finally {
        setIsLoading(false)

        // 작업 완료 후 서버에서 최신 데이터 조회하여 상태 동기화
        try {
          const updatedWishlist = await getWishlistService({
            userId: user.id,
            useCache: false,
          })
          setWishlist(updatedWishlist)
        } catch (syncError) {
          console.error("위시리스트 동기화 실패:", syncError)
          // 동기화 실패는 사용자에게 알리지 않음
        }
      }
    },
    [user, wishlist]
  )

  // 초기 로드
  useEffect(() => {
    fetchWishlist()
  }, [fetchWishlist])

  return {
    wishlist,
    isLoading,
    error,
    addItem,
    removeItem,
    toggleItem,
    isInWishlist,
    getWishlistId,
    refetch: fetchWishlist,
  }
}
