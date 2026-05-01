import {
  getCurrentMonthSavings,
  getCurrentSubscription,
} from "@/lib/api/membership"
import { SavingsBanner } from "../../../components/mobile/savings-banner"
import type { SavingsData } from "../../../types/mypage-types"

/**
 * 절약액 및 구독 정보 Wrapper
 */
export async function SavingsBannerWrapper() {
  const [savings, subscription] = await Promise.all([
    getCurrentMonthSavings().catch(() => null),
    getCurrentSubscription().catch(() => null),
  ])

  const savingsData: SavingsData = {
    totalSavings: savings?.totalSavings ?? 0,
    hasSubscription: subscription?.status === "ACTIVE",
    tierName: subscription?.plan?.tier?.name || undefined,
  }

  return <SavingsBanner initialData={savingsData} />
}
