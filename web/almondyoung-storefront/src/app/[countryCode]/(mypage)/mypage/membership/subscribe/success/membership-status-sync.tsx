"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useMembership } from "@/contexts/membership-context"
import { getCurrentSubscription } from "@/lib/api/membership/client"

export default function MembershipStatusSync() {
  const router = useRouter()
  const { setMembership } = useMembership()

  useEffect(() => {
    const syncMembership = async () => {
      try {
        const subscription = await getCurrentSubscription()

        if (subscription?.status === "ACTIVE") {
          setMembership?.({
            status: "membership",
            tier: {
              code: subscription.tier?.code ?? "membership",
              name: subscription.tier?.name ?? "멤버십",
              priorityLevel: subscription.tier?.priorityLevel ?? 0,
            },
          })
        } else {
          setMembership?.({ status: "regular" })
        }
      } catch {
        // 실패 시 강제 변경하지 않음
      } finally {
        router.refresh()
      }
    }

    syncMembership()
  }, [router, setMembership])

  return null
}
