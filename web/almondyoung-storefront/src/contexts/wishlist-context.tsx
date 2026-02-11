"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useUser } from "@/contexts/user-context"
import { getWishlist, toggleWishlist } from "@lib/api/users/wishlist/client"

export type WishlistAction = "added" | "removed"

type WishlistContextValue = {
  ids: Set<string>
  isLoaded: boolean
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  toggle: (productId: string) => Promise<WishlistAction | null>
  isWishlisted: (productId: string) => boolean
  isPending: (productId: string) => boolean
}

const WishlistContext = createContext<WishlistContextValue | null>(null)

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser()
  const isLoggedIn = !!user

  const [ids, setIds] = useState<Set<string>>(new Set())
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const idsRef = useRef(ids)
  useEffect(() => {
    idsRef.current = ids
  }, [ids])

  const refresh = useCallback(async () => {
    if (!isLoggedIn) {
      setIds(new Set())
      setIsLoaded(true)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const wishlistItems = await getWishlist()
      const nextIds = new Set(wishlistItems.map((item) => item.productId))
      setIds(nextIds)
      setIsLoaded(true)
    } catch (err) {
      console.error("위시리스트 로드 실패:", err)
      setError("위시리스트를 불러오는데 실패했습니다.")
      setIsLoaded(true)
    } finally {
      setIsLoading(false)
    }
  }, [isLoggedIn])

  useEffect(() => {
    setIsLoaded(false)
    refresh()
  }, [refresh])

  const toggle = useCallback(async (productId: string) => {
    const wasWishlisted = idsRef.current.has(productId)

    setPendingIds((prev) => new Set(prev).add(productId))
    setIds((prev) => {
      const next = new Set(prev)
      if (wasWishlisted) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })

    try {
      const result = await toggleWishlist(productId)
      const action = result?.action

      if (action === "added" || action === "removed") {
        setIds((prev) => {
          const next = new Set(prev)
          if (action === "added") {
            next.add(productId)
          } else {
            next.delete(productId)
          }
          return next
        })
        return action
      }

      return null
    } catch (err) {
      setIds((prev) => {
        const next = new Set(prev)
        if (wasWishlisted) {
          next.add(productId)
        } else {
          next.delete(productId)
        }
        return next
      })
      throw err
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(productId)
        return next
      })
    }
  }, [])

  const value = useMemo<WishlistContextValue>(
    () => ({
      ids,
      isLoaded,
      isLoading,
      error,
      refresh,
      toggle,
      isWishlisted: (productId: string) => ids.has(productId),
      isPending: (productId: string) => pendingIds.has(productId),
    }),
    [ids, isLoaded, isLoading, error, refresh, toggle, pendingIds]
  )

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  )
}

export const useWishlist = () => {
  const context = useContext(WishlistContext)
  if (!context) {
    throw new Error("useWishlist must be used within WishlistProvider")
  }
  return context
}
