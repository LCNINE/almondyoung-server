import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { OPENING_CATEGORY_KEYS, OPENING_GUGUN, openingPath } from "@/lib/beautytop/opening-areas"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

interface PageProps {
  params: Promise<{ countryCode: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { countryCode } = await params
  const t = await getTranslations("beautytop.opening")
  return {
    title: t("indexTitle"),
    description: t("indexDescription"),
    alternates: { canonical: `/${countryCode}/beautytop/opening` },
  }
}

// Links only: no source data is read here, so this page costs nothing upstream.
export default async function OpeningIndexPage() {
  const t = await getTranslations("beautytop.opening")

  return (
    <div className="bg-secondary">
      <div className="container mx-auto max-w-[640px] px-4 pt-6 pb-16">
        <SiteBreadcrumb
          className="mb-4"
          items={[{ label: t("crumbBeautytop"), href: "/beautytop" }, { label: t("crumbOpening") }]}
        />
        <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
          {t("eyebrow")}
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[12px]">{t("beta")}</span>
        </p>
        <h1 className="text-foreground mt-2 text-[22px] leading-[31px] font-bold">{t("indexHeadline")}</h1>
        <p className="text-muted-foreground mt-1 text-[15px] leading-[22.5px]">{t("indexSub")}</p>

        {OPENING_CATEGORY_KEYS.map((category) => (
          <section key={category} className="bg-background mt-4 rounded-2xl p-5">
            <h2 className="text-foreground text-[17px] font-bold">{t("indexCategory", { category })}</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {OPENING_GUGUN.map((gugun) => (
                <li key={gugun}>
                  <LocalizedClientLink
                    href={openingPath(gugun, category)}
                    className="bg-muted text-foreground hover:bg-secondary inline-flex h-9 items-center rounded-full px-3 text-[13px] transition-colors duration-150"
                  >
                    {gugun}
                  </LocalizedClientLink>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-muted-foreground mt-6 text-[12px] leading-[17px]">{t("note")}</p>
      </div>
    </div>
  )
}
