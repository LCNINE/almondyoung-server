import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { BeautyTopBoard } from "@/domains/beautytop/components/beautytop-board"
import MembershipBanner from "@/domains/home/components/banner/membership-banner"
import { NOINDEX } from "@/lib/seo"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { cookies } from "next/headers"

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
  const loggedIn = Boolean((await cookies()).get("_medusa_jwt")?.value)

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

          {loggedIn ? (
            <BeautyTopBoard />
          ) : (
            <div className="bg-background mt-6 rounded-2xl px-5 pb-5">
              <ul className="divide-border divide-y">
                {(["price", "market", "rank"] as const).map((key) => (
                  <li key={key} className="py-5">
                    <p className="text-foreground text-[17px] leading-6 font-bold">
                      {t(`intro.${key}Title`)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[15px] leading-[22.5px] break-keep">
                      {t(`intro.${key}Body`)}
                    </p>
                  </li>
                ))}
              </ul>
              <LocalizedClientLink
                href={`/login?redirect_to=${encodeURIComponent(`/${countryCode}/beautytop`)}`}
                className="bg-header-background hover:bg-header-background/90 [&>span]:text-primary mt-1 flex h-[52px] items-center justify-center gap-1.5 rounded-xl text-base font-bold text-white transition-colors duration-150"
              >
                {t("intro.login")} <span aria-hidden>→</span>
              </LocalizedClientLink>
            </div>
          )}
        </div>
      </div>
      <MembershipBanner showOnMobile />
    </>
  )
}
