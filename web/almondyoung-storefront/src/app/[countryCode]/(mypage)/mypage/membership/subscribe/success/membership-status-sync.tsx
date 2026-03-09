"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useMembership } from "@/contexts/membership-context"

export default function MembershipStatusSync() {
  const router = useRouter()
  const { syncMembership } = useMembership()

  useEffect(() => {
    let cancelled = false

    const syncMembershipState = async () => {
      try {
        await syncMembership?.({
          retryUntilMembership: true,
          maxAttempts: 15,
          retryIntervalMs: 1000,
        })
      } catch {
        // 실패 시 강제 변경하지 않음
      } finally {
        if (!cancelled) {
          router.refresh()
        }
      }
    }

    void syncMembershipState()

    return () => {
      cancelled = true
    }
  }, [router, syncMembership])

  return null
}
