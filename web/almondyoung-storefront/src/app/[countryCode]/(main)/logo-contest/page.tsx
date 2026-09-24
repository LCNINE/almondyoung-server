import type { Metadata } from "next"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { EntryCard } from "@/domains/logo-contest/components/entry-card"
import { JoinPanel } from "@/domains/logo-contest/components/join-panel"
import { LiveRanking } from "@/domains/logo-contest/components/live-ranking"
import {
  logoContestHeroImage,
  logoContestPrizeBubble,
} from "@/domains/logo-contest/banner-assets"
import {
  getLogoContestStatus,
  getMyLogoContestState,
  listLogoContestEntries,
} from "@/lib/api/ugc/logo-contest"
import type { LogoContestEntry } from "@/lib/types/ui/logo-contest"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"
import Image from "next/image"

const PAGE_SIZES = [12, 24, 60] as const
const SORTS = ["latest", "popular"] as const

const formatContestDate = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(iso))
    .replaceAll("-", ".")

interface PageProps {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { countryCode } = await params
  const t = await getTranslations("logoContest")

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: `/${countryCode}/logo-contest` },
    openGraph: { title: t("metaTitle"), description: t("metaDescription") },
  }
}

export default async function LogoContestPage({
  params,
  searchParams,
}: PageProps) {
  const { countryCode } = await params
  const raw = await searchParams
  const t = await getTranslations("logoContest")

  const sort = SORTS.includes(raw.sort as (typeof SORTS)[number])
    ? (raw.sort as (typeof SORTS)[number])
    : "latest"
  const requestedPage = Number(raw.page)
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const requestedLimit = Number(raw.limit)
  const pageSize = PAGE_SIZES.includes(
    requestedLimit as (typeof PAGE_SIZES)[number]
  )
    ? requestedLimit
    : 12

  const [status, entries, ranking, myState] = await Promise.all([
    getLogoContestStatus(),
    listLogoContestEntries({ sort, page, limit: pageSize }).catch(() => null),
    listLogoContestEntries({ sort: "popular", limit: 4 }).catch(() => null),
    getMyLogoContestState().catch(() => null),
  ])
  const displaySort = status.isClosed ? "popular" : sort

  const items: LogoContestEntry[] = entries?.data ?? []
  const total = entries?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const firstVisiblePage = Math.max(1, Math.min(page - 2, totalPages - 4))
  const visiblePages = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => firstVisiblePage + index
  )
  const periodLabel = t("period", {
    start: formatContestDate(status.startsAt),
    end: formatContestDate(status.endsAt),
  })
  const phase = status.isClosed ? "closed" : status.isOpen ? "open" : "upcoming"

  return (
    <div className="container mx-auto max-w-[1360px] px-4 pt-6 pb-16 xl:px-[40px]">
      <SiteBreadcrumb className="mb-4" items={[{ label: t("title") }]} />

      <header className="relative -mx-4 aspect-[780/360] overflow-hidden bg-[#dff6ff] text-[#143247] md:mx-0 md:aspect-auto md:min-h-[380px] md:rounded-[28px] md:border md:border-[#9bd9ef]">
        <Image
          src={logoContestHeroImage}
          alt=""
          fill
          sizes="(max-width: 767px) 100vw, (min-width: 1360px) 1360px, 100vw"
          className="object-cover object-[75%_center] md:object-[center_10%]"
          priority
        />
        <div className="absolute top-[9%] left-[6%] z-10 max-w-[650px] md:relative md:top-auto md:left-auto md:px-6 md:py-11 lg:px-12">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-extrabold tracking-[0.05em] text-[#143247] md:text-sm">
              {t("title")}
            </span>
            {phase !== "upcoming" && (
              <span className="border-l border-[#a8d2e5] pl-3 text-[10px] font-medium text-[#55778a] md:text-xs">
                {t(`status.${phase}`)}
              </span>
            )}
          </div>
          <h1
            className="mt-1 text-[23px] leading-[1.12] tracking-[-0.04em] whitespace-pre-line text-[#143247] [text-shadow:0_2px_0_#9bdcf5,0_4px_0_#5fb9df] md:mt-5 md:text-5xl md:leading-[1.2] md:[-webkit-text-stroke:1px_#0b2940] lg:text-[3.25rem]"
            style={{ fontFamily: '"Jua Logo Contest", Pretendard, sans-serif' }}
          >
            {t("headline")}
          </h1>
        </div>
        <div className="absolute top-[52%] left-[6%] z-10 h-[54px] w-[145px] md:top-[220px] md:left-12 md:h-[100px] md:w-[240px]">
          <Image
            src={logoContestPrizeBubble}
            alt=""
            fill
            sizes="(max-width: 767px) 145px, 240px"
            className="object-contain"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-1 text-[#143247] md:pt-3">
            <span className="text-[8px] font-semibold md:text-xs">
              {t("prizeLabel")}
            </span>
            <strong className="text-[13px] font-extrabold tracking-tight md:mt-1 md:text-xl">
              {t("prizeAmount")}
            </strong>
          </div>
        </div>
        {!status.isClosed && !myState?.entry && (
          <div className="absolute right-4 bottom-4 z-20 w-[118px] md:right-8 md:bottom-8 md:w-auto">
            <JoinPanel
              countryCode={countryCode}
              canSubmit={status.isOpen}
              upcomingNotice={t("periodBefore", {
                start: formatContestDate(status.startsAt),
              })}
            />
          </div>
        )}
      </header>
      <div className="mb-12 pt-6">
        <div className="max-w-xl text-[#143247]">
          <p className="text-sm leading-6 whitespace-pre-line sm:text-base">
            {t("lead")}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-[3px] border-[#F29219] pl-3 text-sm">
            <span className="font-medium text-[#5c7180]">
              {t("periodLabel")}
            </span>
            <strong className="font-bold tabular-nums">{periodLabel}</strong>
          </div>
        </div>
      </div>

      {ranking && <LiveRanking initialEntries={ranking.data} />}

      <div className="mb-8 grid grid-cols-[1fr_auto] items-center gap-y-2 sm:flex sm:gap-4">
        <h2 className="text-foreground text-xl font-bold">{t("browse")}</h2>
        {!status.isClosed && (
          <nav
            className="col-start-2 row-start-1 flex gap-5 sm:ml-auto"
            aria-label={t("sortLabel")}
          >
            {SORTS.map((value) => (
              <LocalizedClientLink
                key={value}
                href={`/logo-contest?sort=${value}&limit=${pageSize}`}
                aria-current={displaySort === value ? "page" : undefined}
                className={cn(
                  "px-1 py-2 text-sm font-semibold transition-colors",
                  displaySort === value
                    ? "text-[#F29219]"
                    : "text-[#607585] hover:text-[#F29219]"
                )}
              >
                {t(`sort.${value}`)}
              </LocalizedClientLink>
            ))}
          </nav>
        )}
        <details
          className={cn(
            "group relative col-start-1 row-start-2 w-36 text-sm",
            status.isClosed && "sm:ml-auto"
          )}
        >
          <summary
            aria-label={t("pageSize.label")}
            className="flex h-9 cursor-pointer list-none items-center justify-between rounded-xl px-3 font-medium text-[#24343d] outline-none focus-visible:ring-2 focus-visible:ring-[#F29219] [&::-webkit-details-marker]:hidden"
          >
            {t("pageSize.option", { count: pageSize })}
            <ChevronDown
              className="size-4 text-[#607585] transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="absolute top-full left-0 z-20 mt-1 w-36 rounded-xl border border-[#dce3e8] bg-white p-1 shadow-lg">
            {PAGE_SIZES.map((size) => (
              <LocalizedClientLink
                key={size}
                href={`/logo-contest?sort=${displaySort}&limit=${size}`}
                aria-current={size === pageSize ? "page" : undefined}
                className="flex h-8 items-center justify-between rounded-lg px-2 text-[#24343d] hover:bg-[#f7f8fa]"
              >
                {t("pageSize.option", { count: size })}
                {size === pageSize && (
                  <Check className="size-4" aria-hidden="true" />
                )}
              </LocalizedClientLink>
            ))}
          </div>
        </details>
      </div>

      {!entries && (
        <p className="text-muted-foreground py-16 text-center text-sm">
          {t("loadFail")}
        </p>
      )}

      {entries && items.length === 0 && (
        <p className="text-muted-foreground py-28 text-center text-sm">
          {status.isOpen ? t("empty") : t("emptyClosed")}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5">
        {items.map((entry, index) => (
          <li
            key={entry.id}
            className="motion-safe:animate-[fade-in_500ms_ease-out_both]"
            style={{ animationDelay: `${Math.min(index, 7) * 65}ms` }}
          >
            <EntryCard
              entry={entry}
              countryCode={countryCode}
              canVote={status.isOpen}
              isClosed={status.isClosed}
              isOwnEntry={myState?.entry?.id === entry.id}
              votedEntryId={myState?.votedEntryId ?? null}
              upcomingNotice={t("periodBefore", {
                start: formatContestDate(status.startsAt),
              })}
              priority={index < 4}
            />
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <nav
          data-pagination
          className="mt-10 flex items-center justify-center gap-5"
          aria-label={t("paginationLabel")}
        >
          {page > 1 ? (
            <LocalizedClientLink
              data-page-prev
              href={`/logo-contest?sort=${displaySort}&limit=${pageSize}&page=${page - 1}`}
              aria-label={t("previousPage")}
              className="flex size-8 items-center justify-center text-[#607585] hover:text-[#143247]"
            >
              <ChevronLeft className="size-5" />
            </LocalizedClientLink>
          ) : (
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center text-[#bdcbd2]"
            >
              <ChevronLeft className="size-5" />
            </span>
          )}
          {visiblePages.map((value) => (
            <LocalizedClientLink
              key={value}
              href={`/logo-contest?sort=${displaySort}&limit=${pageSize}&page=${value}`}
              aria-current={value === page ? "page" : undefined}
              className={cn(
                "flex min-w-5 items-center justify-center text-sm transition-colors",
                value === page
                  ? "font-bold text-[#143247]"
                  : "font-medium text-[#879aa5] hover:text-[#143247]"
              )}
            >
              {value}
            </LocalizedClientLink>
          ))}
          {page < totalPages ? (
            <LocalizedClientLink
              data-page-next
              href={`/logo-contest?sort=${displaySort}&limit=${pageSize}&page=${page + 1}`}
              aria-label={t("nextPage")}
              className="flex size-8 items-center justify-center text-[#607585] hover:text-[#143247]"
            >
              <ChevronRight className="size-5" />
            </LocalizedClientLink>
          ) : (
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center text-[#bdcbd2]"
            >
              <ChevronRight className="size-5" />
            </span>
          )}
        </nav>
      )}
    </div>
  )
}
