import type { Metadata } from "next"
import { notFound } from "next/navigation"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { VoteButton } from "@/domains/logo-contest/components/vote-button"
import {
  logoContestVoteOff,
  logoContestVoteOn,
} from "@/domains/logo-contest/banner-assets"
import { ListingGallery } from "@/domains/shop-trade/components/listing-gallery"
import {
  getLogoContestEntry,
  getLogoContestStatus,
  getMyLogoContestState,
} from "@/lib/api/ugc/logo-contest"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { ChevronLeft, Trophy } from "lucide-react"
import { getTranslations } from "next-intl/server"
import Image from "next/image"

interface PageProps {
  params: Promise<{ countryCode: string; id: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params
  const t = await getTranslations("logoContest")
  const entry = await getLogoContestEntry(id).catch(() => null)

  if (!entry) return { title: t("metaTitle") }

  return {
    title: `${entry.title} | ${t("title")}`,
    description: entry.description ?? t("metaDescription"),
    openGraph: {
      title: entry.title,
      description: entry.description ?? t("metaDescription"),
      images: entry.mediaFileIds[0]
        ? [getThumbnailUrl(entry.mediaFileIds[0])]
        : undefined,
    },
  }
}

export default async function LogoContestEntryPage({ params }: PageProps) {
  const { countryCode, id } = await params
  const t = await getTranslations("logoContest")

  const [entry, status, myState] = await Promise.all([
    getLogoContestEntry(id).catch(() => null),
    getLogoContestStatus(),
    getMyLogoContestState().catch(() => null),
  ])

  if (!entry) notFound()

  const isOwnEntry = myState?.entry?.id === entry.id

  return (
    <div className="container mx-auto max-w-[800px] px-4 py-6">
      <SiteBreadcrumb
        className="mb-4"
        items={[
          { label: t("title"), href: "/logo-contest" },
          { label: entry.title },
        ]}
      />

      <ListingGallery
        images={entry.mediaFileIds}
        alt={entry.title}
        fit="contain"
      />

      <header className="mt-6">
        {entry.isWinner && (
          <span className="bg-primary mb-3 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-white">
            <Trophy className="h-3 w-3" />
            {t("winner")}
          </span>
        )}
        <h1 className="text-foreground text-xl font-bold">{entry.title}</h1>
        <p className="text-muted-foreground mt-2 text-xs">
          {t("detail.author")} {entry.authorName} · {t("detail.submittedAt")}{" "}
          {formatDate(entry.createdAt, DATE_FORMATS.KO_DOT)}
        </p>
        <p className="text-foreground mt-3 inline-flex items-center gap-1.5 text-sm font-bold">
          <Image
            src={
              myState?.votedEntryId === entry.id
                ? logoContestVoteOn
                : logoContestVoteOff
            }
            alt=""
            width={24}
            height={24}
            unoptimized
          />
          {t("voteCount", { count: entry.voteCount })}
        </p>
      </header>

      {entry.description && (
        <p className="text-foreground mt-6 text-sm leading-6 whitespace-pre-wrap">
          {entry.description}
        </p>
      )}

      {!status.isClosed && (
        <div className="mt-8">
          <VoteButton
            countryCode={countryCode}
            entryId={entry.id}
            isOwnEntry={isOwnEntry}
            votedEntryId={myState?.votedEntryId ?? null}
            voteCount={entry.voteCount}
            canVote={status.isOpen}
            upcomingNotice={t("periodBefore", {
              start: formatDate(status.startsAt, DATE_FORMATS.KO_DOT),
            })}
          />
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <LocalizedClientLink
          href="/logo-contest"
          className="border-border text-foreground hover:bg-muted flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("detail.back")}
        </LocalizedClientLink>
      </div>
    </div>
  )
}
