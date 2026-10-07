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
          <h1 className="text-foreground text-[22px] leading-[31px] font-bold">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-[15px] leading-[22.5px]">
            {t("subtitle")}
          </p>

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
