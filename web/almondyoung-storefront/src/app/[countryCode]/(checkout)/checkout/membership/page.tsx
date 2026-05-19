import { WithHeaderLayout } from "@components/layout/with-header-layout"
import ProtectedRoute from "@components/protected-route"
import { fetchMe } from "@lib/api/users/me"
import { getPlans } from "@lib/api/membership"
import MembershipCheckoutTemplate from "@/domains/checkout/templates/membership-checkout-template"
import { getTranslations } from "next-intl/server"

export default async function MembershipCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ planId?: string }>
}) {
  const { countryCode } = await params
  const { planId } = await searchParams
  const t = await getTranslations("checkout.membership")

  if (!planId) {
    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: t("headerTitle"),
        }}
      >
        <section className="mx-auto max-w-xl rounded-lg border border-gray-200 bg-white p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            {t("missingPlanTitle")}
          </h2>
          <p className="mt-2 text-sm text-gray-500">{t("missingPlanDesc")}</p>
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
          mobileSubBackHeaderTitle: t("headerTitle"),
        }}
      >
        <section className="mx-auto max-w-xl rounded-lg border border-gray-200 bg-white p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            {t("planNotFoundTitle")}
          </h2>
          <p className="mt-2 text-sm text-gray-500">{t("planNotFoundDesc")}</p>
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
          mobileSubBackHeaderTitle: t("headerTitle"),
        }}
      >
        <MembershipCheckoutTemplate
          user={user}
          planId={selectedPlan.plan.id}
          planName={selectedPlan.tier?.name ?? t("fallbackPlanName")}
          price={selectedPlan.plan.price}
        />
      </WithHeaderLayout>
    </ProtectedRoute>
  )
}
