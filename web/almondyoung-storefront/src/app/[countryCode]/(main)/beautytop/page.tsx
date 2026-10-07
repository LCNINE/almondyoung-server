import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { BeautyTopPreview } from "@/domains/beautytop/area/beautytop-preview"
import { BeautyTopBoard } from "@/domains/beautytop/components/beautytop-board"
import MembershipBanner from "@/domains/home/components/banner/membership-banner"
import { NOINDEX } from "@/lib/seo"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { getBeautyTopAccess } from "@/lib/beautytop/access"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("beautytop")
  return { title: t("title"), robots: NOINDEX }
}

interface PageProps {
  params: Promise<{ countryCode: string }>
}

export default async function BeautyTopPage({ params }: PageProps) {
  const { countryCode } = await params
  const t = await getTranslations("beautytop")
  const access = await getBeautyTopAccess()

  return (
    <>
      <div className="bg-secondary">
        <div className="container mx-auto max-w-[640px] px-4 pt-6 pb-10">
          <SiteBreadcrumb className="mb-4" items={[{ label: t("title") }]} />
          <div className="flex items-center gap-2">
            <h1 className="text-foreground text-[22px] leading-[31px] font-bold">
              {t("title")}
            </h1>
            <span className="bg-foreground text-background rounded-full px-2 py-[3px] text-[12px] leading-none font-bold">
              {t("beta.badge")}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-[15px] leading-[22.5px]">
            {t("subtitle")}
          </p>
          <div className="bg-background border-border mt-4 flex flex-col gap-1.5 rounded-xl border px-4 py-3.5">
            <p className="text-foreground text-[14px] font-bold">{t("beta.title")}</p>
            <p className="text-muted-foreground text-[13px] leading-[19px] break-keep">{t("beta.body")}</p>
            <LocalizedClientLink
              href="/cs?tab=inquiry"
              className="text-foreground mt-0.5 w-fit text-[13px] font-medium underline-offset-4 hover:underline"
            >
              {t("beta.link")} →
            </LocalizedClientLink>
          </div>

          {access === "member" ? (
            <BeautyTopBoard />
          ) : (
            <BeautyTopPreview
              signedIn={access === "nonMember"}
              loginHref={`/login?redirect_to=${encodeURIComponent(`/${countryCode}/beautytop`)}`}
            />
          )}
        </div>
      </div>
      <MembershipBanner showOnMobile />
    </>
  )
}
