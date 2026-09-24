import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { EntryForm } from "@/domains/logo-contest/components/entry-form"
import { siteConfig } from "@/lib/config/site"
import {
  getLogoContestStatus,
  getMyLogoContestState,
} from "@/lib/api/ugc/logo-contest"
import { getTranslations } from "next-intl/server"

interface PageProps {
  params: Promise<{ countryCode: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("logoContest.form")
  return { title: t("title") }
}

export default async function LogoContestSubmitPage({ params }: PageProps) {
  const { countryCode } = await params
  const t = await getTranslations("logoContest")
  const [status, myState] = await Promise.all([
    getLogoContestStatus(),
    getMyLogoContestState().catch(() => null),
  ])

  if (!status.isOpen || myState?.entry) redirect(`/${countryCode}/logo-contest`)
  if (!myState) {
    redirect(
      `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent("/logo-contest/submit")}`
    )
  }

  return (
    <div className="mx-auto max-w-[752px] px-4 pt-8 pb-20 motion-safe:animate-[fade-in_400ms_ease-out_both]">
      <SiteBreadcrumb
        className="mb-6"
        items={[
          { label: t("title"), href: "/logo-contest" },
          { label: t("form.title") },
        ]}
      />
      <EntryForm countryCode={countryCode} />
    </div>
  )
}
