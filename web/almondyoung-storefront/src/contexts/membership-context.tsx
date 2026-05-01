"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

export type MembershipStatus = "guest" | "regular" | "membership"

export interface MembershipTier {
  code: string
  name: string | null
  priorityLevel: number
}

export interface MembershipContextType {
  status: MembershipStatus
  isMembershipPricing: boolean
  tier?: MembershipTier
  setMembership?: Dispatch<SetStateAction<MembershipContextType>>
  syncMembership?: (options?: {
    retryUntilMembership?: boolean
    maxAttempts?: number
    retryIntervalMs?: number
  }) => Promise<MembershipContextType | null>
}

const MembershipContext = createContext<MembershipContextType>({
  status: "guest",
  isMembershipPricing: false,
})

export function MembershipProvider({
  children,
  initialMembership,
}: {
  children: React.ReactNode
  initialMembership: MembershipContextType
}) {
  const [membership, setMembership] = useState<MembershipContextType>(
    initialMembership
  )

  const syncMembership = useCallback(
    async ({
      retryUntilMembership = false,
      maxAttempts = 1,
      retryIntervalMs = 1200,
    }: {
      retryUntilMembership?: boolean
      maxAttempts?: number
      retryIntervalMs?: number
    } = {}): Promise<MembershipContextType | null> => {
      const attempts = Math.max(1, maxAttempts)
      let latest: MembershipContextType | null = null

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const response = await fetch("/api/auth/membership-state", {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          })

          if (!response.ok) {
            throw new Error(`Failed to sync membership: ${response.status}`)
          }

          const next = (await response.json()) as MembershipContextType
          latest = next

          setMembership((prev) => {
            const sameTier =
              prev.tier?.code === next.tier?.code &&
              prev.tier?.name === next.tier?.name &&
              prev.tier?.priorityLevel === next.tier?.priorityLevel
            if (
              prev.status === next.status &&
              prev.isMembershipPricing === next.isMembershipPricing &&
              sameTier
            ) {
              return prev
            }
            return next
          })

          if (!retryUntilMembership || next.isMembershipPricing) {
            return next
          }
        } catch {
          // 네트워크/인증 오류 시 다음 기회에 재시도
        }

        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
        }
      }

      return latest
    },
    []
  )

  useEffect(() => {
    void syncMembership()
  }, [syncMembership])

  useEffect(() => {
    const handleFocus = () => {
      void syncMembership()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncMembership()
      }
    }

    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [syncMembership])

  const value = useMemo(
    () => ({
      ...membership,
      setMembership,
      syncMembership,
    }),
    [membership, syncMembership]
  )

  return (
    <MembershipContext.Provider value={value}>
      {children}
    </MembershipContext.Provider>
  )
}

export const useMembership = () => useContext(MembershipContext)
