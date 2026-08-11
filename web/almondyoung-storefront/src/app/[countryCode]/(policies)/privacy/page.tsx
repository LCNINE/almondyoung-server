import { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import {
  PrivacyPolicy,
  PRIVACY_POLICY_EFFECTIVE_DATE,
} from "@/domains/consents/components/privacy-policy"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("policies.privacy")
  return { title: t("title") }
}

export default async function PrivacyPage() {
  const t = await getTranslations("policies.privacy")

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <SiteBreadcrumb className="mb-4" items={[{ label: t("title") }]} />
      <h1 className="mb-2 text-2xl font-bold">{t("title")}</h1>
      <p className="text-muted-foreground mb-8 text-sm">
        {t("effectiveDate", { date: PRIVACY_POLICY_EFFECTIVE_DATE })}
      </p>

      <PrivacyPolicy />
    </div>
  )
}
