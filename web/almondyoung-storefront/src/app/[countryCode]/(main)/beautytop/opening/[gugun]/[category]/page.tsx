import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import {
  OPENING_CATEGORIES,
  OPENING_GUGUN,
  OPENING_SIDO,
  isOpeningArea,
  openingPath,
} from "@/lib/beautytop/opening-areas"
import { getOpeningData } from "@/lib/beautytop/opening-data"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { NOINDEX } from "@/lib/seo"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"

interface PageProps {
  params: Promise<{ countryCode: string; gugun: string; category: string }>
}

function decode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function resolveArea(params: PageProps["params"]) {
  const { countryCode, gugun: rawGugun, category: rawCategory } = await params
  const gugun = decode(rawGugun)
  const category = decode(rawCategory)
  // Outside the fixed list there is no page: a crawler must not be able to widen the set of
  // areas the server asks the source about.
  if (!isOpeningArea(gugun, category)) notFound()
  return { countryCode, gugun, category }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { countryCode, gugun, category } = await resolveArea(params)
  const t = await getTranslations("beautytop.opening")
  const data = await getOpeningData(gugun, category)
  return {
    title: t("metaTitle", { gugun, category }),
    description: t("metaDescription", { sido: OPENING_SIDO, gugun, category }),
    alternates: { canonical: `/${countryCode}${openingPath(gugun, category)}` },
    // Without numbers the page is only a pause notice; keep that out of the index.
    ...(data ? {} : { robots: NOINDEX }),
  }
}

export default async function OpeningPage({ params }: PageProps) {
  const { gugun, category } = await resolveArea(params)
  const t = await getTranslations("beautytop.opening")
  const data = await getOpeningData(gugun, category)
  const storeCategories = OPENING_CATEGORIES[category].flatMap(
    (key) => FIXED_CATEGORIES.find((c) => c.key === key) ?? []
  )
  const peak = data?.months.reduce<(typeof data.months)[number] | null>(
    (best, m) => (best === null || m.opened > best.opened ? m : best),
    null
  )
  const scale = Math.max(1, ...(data?.months ?? []).flatMap((m) => [m.opened, m.closed]))
  const monthLabel = (month: string) => t("monthLabel", { month: Number(month.slice(5, 7)) })

  return (
    <div className="bg-secondary">
      <div className="container mx-auto max-w-[640px] px-4 pt-6 pb-16">
        <SiteBreadcrumb
          className="mb-4"
          items={[
            { label: t("crumbBeautytop"), href: "/beautytop" },
            { label: t("crumbOpening"), href: "/beautytop/opening" },
            { label: `${gugun} ${category}` },
          ]}
        />
        <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
          {t("eyebrow")}
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[12px]">{t("beta")}</span>
        </p>
        <h1 className="text-foreground mt-2 text-[22px] leading-[31px] font-bold whitespace-pre-line">
          {t("headline", { gugun, category })}
        </h1>

        {data === null ? (
          <p className="bg-background text-muted-foreground mt-6 rounded-xl p-5 text-[15px]">{t("unavailable")}</p>
        ) : (
          <>
            <section aria-label={t("nowLabel", { category })} className="bg-background mt-6 rounded-2xl p-5">
              <p className="text-muted-foreground text-[14px]">{t("nowLabel", { category })}</p>
              <p className="text-foreground mt-1 text-[26px] font-bold">{t("places", { count: data.shops })}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { label: t("opened"), value: data.opened === null ? t("unknown") : t("places", { count: data.opened }) },
                  { label: t("closed"), value: data.closed === null ? t("unknown") : t("places", { count: data.closed }) },
                  {
                    label: t("density"),
                    value:
                      data.residentsPerShop === null
                        ? t("unknown")
                        : t("densityValue", { count: Math.round(data.residentsPerShop / 10) * 10 }),
                  },
                ].map((tile) => (
                  <div key={tile.label} className="bg-muted rounded-xl p-3">
                    <dt className="text-muted-foreground text-[12px]">{tile.label}</dt>
                    <dd className="text-foreground mt-1 text-[16px] font-bold">{tile.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {data.months.length > 1 && peak && (
              <section className="bg-background mt-3 rounded-2xl p-5">
                <h2 className="text-foreground text-[18px] font-bold">{t("monthlyTitle")}</h2>
                <figure className="mt-3">
                  <div className="text-muted-foreground flex gap-4 text-[12px]" aria-hidden="true">
                    <span className="flex items-center gap-1.5">
                      <span className="bg-foreground h-2.5 w-2.5 rounded-sm" />
                      {t("legendOpened")}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="bg-border h-2.5 w-2.5 rounded-sm" />
                      {t("legendClosed")}
                    </span>
                  </div>
                  <ol className="mt-3 flex h-[140px] items-end gap-1.5" aria-hidden="true">
                    {data.months.map((m) => (
                      <li key={m.month} className="flex h-full flex-1 flex-col justify-end">
                        <div className="flex h-full items-end gap-0.5">
                          <span className="bg-foreground flex-1 rounded-t-sm" style={{ height: `${(m.opened / scale) * 100}%` }} />
                          <span className="bg-border flex-1 rounded-t-sm" style={{ height: `${(m.closed / scale) * 100}%` }} />
                        </div>
                        <span className="text-muted-foreground mt-1 text-center text-[10px]">{monthLabel(m.month)}</span>
                      </li>
                    ))}
                  </ol>
                  <figcaption className="text-foreground mt-3 text-[15px] leading-[22px]">
                    {t.rich("peak", {
                      month: monthLabel(peak.month),
                      opened: peak.opened,
                      closed: peak.closed,
                      b: (chunks) => <b>{chunks}</b>,
                    })}
                  </figcaption>
                </figure>
                <p className="text-muted-foreground mt-2 text-[12px]">{t("partial")}</p>
              </section>
            )}

            {data.otherCategories.length > 1 && (
              <section className="bg-background mt-3 rounded-2xl p-5">
                <h2 className="text-foreground text-[18px] font-bold">{t("othersTitle", { gugun })}</h2>
                <ul className="divide-border mt-2 divide-y">
                  {data.otherCategories.slice(0, 6).map((c) => {
                    const current = c.category === category
                    const label = current ? `${c.category} ${t("othersCurrent")}` : c.category
                    return (
                      <li key={c.category} className="flex justify-between py-2.5 text-[15px]">
                        {!current && isOpeningArea(gugun, c.category) ? (
                          <LocalizedClientLink href={openingPath(gugun, c.category)} className="text-foreground underline underline-offset-4">
                            {label}
                          </LocalizedClientLink>
                        ) : (
                          <span className={current ? "text-foreground font-bold" : "text-foreground"}>{label}</span>
                        )}
                        <span className={current ? "text-foreground font-bold" : "text-foreground"}>
                          {t("places", { count: c.shops })}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </>
        )}

        <section className="bg-background mt-3 flex flex-col gap-3 rounded-2xl p-5">
          <h2 className="text-foreground text-[18px] font-bold">{t("nextTitle")}</h2>
          {storeCategories.map((c, index) => (
            <LocalizedClientLink
              key={c.key}
              href={`/category/${c.handle}`}
              className={
                index === 0
                  ? "bg-primary hover:bg-primary/90 flex h-[52px] items-center justify-center rounded-xl text-base font-bold text-white transition-colors duration-150"
                  : "border-border text-foreground hover:bg-muted flex h-12 items-center justify-center rounded-xl border text-[15px] font-medium transition-colors duration-150"
              }
            >
              {t("materials", { name: c.name })}
            </LocalizedClientLink>
          ))}
          <div className="mt-1 flex flex-col gap-2 rounded-xl bg-zinc-900 p-5 text-white">
            <span className="w-fit rounded-full border border-white/40 px-3 py-1 text-xs">MEMBERSHIP</span>
            <p className="mt-1 text-[16px] leading-[23px] font-bold break-keep">{t("memberTitle", { category })}</p>
            <LocalizedClientLink href="/beautytop" className="w-fit text-[14px] text-white underline underline-offset-4 hover:text-white/80">
              {t("memberLink")}
            </LocalizedClientLink>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-foreground text-[15px] font-medium">{t("elsewhere", { category })}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {OPENING_GUGUN.filter((g) => g !== gugun).map((g) => (
              <li key={g}>
                <LocalizedClientLink
                  href={openingPath(g, category)}
                  className="bg-background text-foreground hover:bg-muted inline-flex h-9 items-center rounded-full px-3 text-[13px] transition-colors duration-150"
                >
                  {g}
                </LocalizedClientLink>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-muted-foreground mt-6 text-[12px] leading-[17px]">{t("note")}</p>
      </div>
    </div>
  )
}
