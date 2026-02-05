import { WithHeaderLayout } from "@components/layout/with-header-layout"
import ProtectedRoute from "@components/protected-route"
import { fetchMe } from "@lib/api/users/me"
import { getPlans } from "@lib/api/membership"
import MembershipCheckoutTemplate from "@/domains/checkout/templates/membership-checkout-template"

export default async function MembershipCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ planId?: string }>
}) {
  const { countryCode } = await params
  const { planId } = await searchParams

  if (!planId) {
    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "멤버십 결제",
        }}
      >
        <section className="mx-auto max-w-xl rounded-lg border border-gray-200 bg-white p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            멤버십 플랜 정보가 없습니다.
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            멤버십 신청 페이지에서 다시 시도해주세요.
          </p>
        </section>
      </WithHeaderLayout>
    )
  }

  const [user, plans] = await Promise.all([fetchMe(), getPlans().catch(() => [])])
  const selectedPlan = plans.find((plan) => plan.plan.id === planId)

  if (!selectedPlan) {
    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "멤버십 결제",
        }}
      >
        <section className="mx-auto max-w-xl rounded-lg border border-gray-200 bg-white p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            멤버십 플랜을 찾을 수 없습니다.
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            다른 플랜으로 다시 시도해주세요.
          </p>
        </section>
      </WithHeaderLayout>
    )
  }

  return (
    <ProtectedRoute>
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "멤버십 결제",
        }}
      >
        <MembershipCheckoutTemplate
          user={user}
          planId={selectedPlan.plan.id}
          planName={selectedPlan.tier?.name ?? "멤버십"}
          price={selectedPlan.plan.price}
        />
      </WithHeaderLayout>
    </ProtectedRoute>
  )
}
