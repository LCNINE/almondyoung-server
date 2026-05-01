import { getCurrentSubscription } from "@/lib/api/membership"
import { PaymentInfoSection } from "../../../components/desktop/payment-info-section"
import type { BillingInfo } from "../../../types/mypage-types"

/**
 * 결제 정보 Wrapper
 */
export async function PaymentInfoWrapper() {
  const subscription = await getCurrentSubscription().catch(() => null)

  let billingInfo: BillingInfo | null = null

  if (subscription && subscription.status === "ACTIVE") {
    billingInfo = {
      nextBillingDate: subscription.nextBillingDate || null,
      nextBillingAmount: subscription.plan?.price || 0,
      periodStart: subscription.currentPeriodStart || null,
      periodEnd: subscription.currentPeriodEnd || null,
    }
  }

  return <PaymentInfoSection initialBillingInfo={billingInfo} />
}
