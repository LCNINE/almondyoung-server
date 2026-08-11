import { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { agreements } from "@/lib/data/agreements"
import { getPlans } from "@lib/api/membership"
import { TermsAndConditions } from "@/domains/membership/components/terms-and-conditions"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("policies.terms")
  return { title: t("title") }
}

export default async function TermsPage() {
  const t = await getTranslations("policies.terms")
  const termsOfService = agreements.find((a) => a.id === "termsOfService")
  const electronicTransaction = agreements.find(
    (a) => a.id === "electronicTransaction"
  )

  // 플랜 조회가 실패해도 약관 전문은 노출한다 — 금액만 빠진다.
  const plans = await getPlans().catch(() => [])
  const monthlyPrice = plans.find((p) => p.plan.durationDays === 30)?.plan.price
  const yearlyPrice = plans.find((p) => p.plan.durationDays === 365)?.plan.price

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <SiteBreadcrumb className="mb-4" items={[{ label: t("title") }]} />
      <h1 className="mb-8 text-2xl font-bold">{t("title")}</h1>

      {termsOfService?.content && (
        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold">{t("almondTerms")}</h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {termsOfService.content}
          </div>
        </section>
      )}

      {electronicTransaction?.content && (
        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold">
            {t("electronicTransaction")}
          </h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {electronicTransaction.content}
          </div>
        </section>
      )}

      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold">
          {t("membershipRecurring")}
        </h2>
        <TermsAndConditions
          monthlyPrice={monthlyPrice}
          yearlyPrice={yearlyPrice}
          billingMode="recurring"
        />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("membershipOneTime")}</h2>
        <TermsAndConditions
          monthlyPrice={monthlyPrice}
          yearlyPrice={yearlyPrice}
          billingMode="one_time"
        />
      </section>
    </div>
  )
}
