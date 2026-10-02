import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { VoteButton } from "@/domains/logo-contest/components/vote-button"
import { ListingGallery } from "@/domains/shop-trade/components/listing-gallery"
import {
  getLogoContestEntry,
  getLogoContestStatus,
  getMyLogoContestState,
} from "@/lib/api/ugc/logo-contest"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { Trophy } from "lucide-react"
import { getTranslations } from "next-intl/server"

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
    <div className="container mx-auto max-w-[1120px] px-4 py-6 pb-16">
      <SiteBreadcrumb
        className="mb-4"
        items={[
          { label: t("title"), href: "/logo-contest" },
          { label: entry.title },
        ]}
      />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)] lg:gap-12">
        <div className="border-border bg-background rounded-[28px] border p-3 shadow-sm sm:p-5 [&_button.bg-muted]:rounded-2xl [&>div]:mt-0">
          <ListingGallery
            images={entry.mediaFileIds}
            alt={entry.title}
            fit="contain"
          />
        </div>

        <div className="lg:pt-5">
          <header>
            {entry.isWinner && (
              <span className="bg-primary mb-3 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-white">
                <Trophy className="h-3 w-3" />
                {t("winner")}
              </span>
            )}
            <p className="text-primary mb-2 text-xs font-bold tracking-[0.16em]">
              {t("title")}
            </p>
            <h1 className="text-foreground text-3xl font-bold tracking-tight break-words sm:text-4xl">
              {entry.title}
            </h1>
            <p className="text-muted-foreground mt-4 text-sm">
              {t("detail.author")} {entry.authorName} ·{" "}
              {t("detail.submittedAt")}{" "}
              {formatDate(entry.createdAt, DATE_FORMATS.KO_DOT)}
            </p>
            {status.isClosed ? (
              <p className="text-muted-foreground mt-5 text-sm font-medium">
                {t("voteCount", { count: entry.voteCount })}
              </p>
            ) : (
              <div className="mt-5">
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
          </header>

          {entry.description && (
            <section className="border-border mt-7 border-t pt-5">
              <h2 className="text-foreground mb-2 text-sm font-bold">
                {t("detail.description")}
              </h2>
              <p className="text-foreground text-sm leading-6 break-words whitespace-pre-wrap">
                {entry.description}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
