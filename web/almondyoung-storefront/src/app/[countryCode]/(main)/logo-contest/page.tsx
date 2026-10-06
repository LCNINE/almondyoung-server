import type { Metadata } from "next"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { EntryCard } from "@/domains/logo-contest/components/entry-card"
import { JoinPanel } from "@/domains/logo-contest/components/join-panel"
import { LiveRanking } from "@/domains/logo-contest/components/live-ranking"
import { logoContestHeroImage } from "@/domains/logo-contest/banner-assets"
import {
  getLogoContestStatus,
  getMyLogoContestState,
  listLogoContestEntries,
} from "@/lib/api/ugc/logo-contest"
import type { LogoContestEntry } from "@/lib/types/ui/logo-contest"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"
import Image from "next/image"

const PAGE_SIZE = 50

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

  const requestedPage = Number(raw.page)
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1

  const [status, entries, ranking, myState] = await Promise.all([
    getLogoContestStatus(),
    listLogoContestEntries({ sort: "popular", page, limit: PAGE_SIZE }).catch(
      () => null
    ),
    listLogoContestEntries({ sort: "popular", limit: 4 }).catch(() => null),
    getMyLogoContestState().catch(() => null),
  ])

  const items: LogoContestEntry[] = entries?.data ?? []
  const total = entries?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstVisiblePage = Math.max(1, Math.min(page - 2, totalPages - 4))
  const visiblePages = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => firstVisiblePage + index
  )
  const periodLabel = t("period", {
    start: formatContestDate(status.startsAt),
    end: formatContestDate(status.endsAt),
  })

  return (
    <div className="container mx-auto max-w-[1360px] px-4 pt-6 pb-16 xl:px-[40px]">
      <SiteBreadcrumb className="mb-4" items={[{ label: t("title") }]} />

      <header className="relative -mx-4 aspect-[780/360] overflow-hidden bg-[#dff6ff] text-[#143247] md:mx-0 md:aspect-auto md:min-h-[380px] md:rounded-[28px] md:border md:border-[#9bd9ef]">
        <Image
          src={logoContestHeroImage}
          alt={t("headline")}
          fill
          sizes="(max-width: 767px) 100vw, (min-width: 1360px) 1360px, 100vw"
          className="object-cover object-left-top"
          priority
        />
        {/* 헤드라인·상금 문구는 손글씨 히어로 이미지에 포함돼 있어 별도 오버레이를 두지 않는다. */}
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
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-[3px] border-[#ffa500] pl-3 text-sm">
            <span className="font-medium text-[#5c7180]">
              {t("periodLabel")}
            </span>
            <strong className="font-bold tabular-nums">{periodLabel}</strong>
          </div>
        </div>
      </div>

      {ranking && <LiveRanking initialEntries={ranking.data} />}

      <div className="mb-8">
        <h2 className="text-foreground text-xl font-bold">{t("browse")}</h2>
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
          className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
          aria-label={t("paginationLabel")}
        >
          {page > 1 ? (
            <LocalizedClientLink
              data-page-prev
              href={`/logo-contest?page=${page - 1}`}
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
              href={`/logo-contest?page=${value}`}
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
              href={`/logo-contest?page=${page + 1}`}
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
          <p className="hidden basis-full text-center text-xs text-[#879aa5] md:block">
            {t("keyboardHint")}
          </p>
        </nav>
      )}
    </div>
  )
}
